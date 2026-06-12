import prisma from "../db.server";
import type { PriceChange } from "./pricing";

export type { AdjustmentType, PriceChange } from "./pricing";
export { adjustmentLabel, computeNewPrice } from "./pricing";

// The Admin API caps a single query at ~1000 cost points, so page sizes are
// chosen to stay under it (products + nested variants both count).
const PRODUCTS_PER_PAGE = 15;
const VARIANTS_PER_PRODUCT = 40;
// productVariantsBulkUpdate accepts at most 250 variants per call.
const VARIANTS_PER_MUTATION = 250;

export type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

export interface VariantRow {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  price: string;
  inventoryQuantity: number | null;
  status: string;
}

export interface VariantPage {
  rows: VariantRow[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export async function fetchVariants(
  graphql: AdminGraphql,
  { query, after }: { query?: string; after?: string },
): Promise<VariantPage> {
  const response = await graphql(
    `#graphql
    query BulkPilotProducts($first: Int!, $query: String, $after: String, $variantsFirst: Int!) {
      products(first: $first, query: $query, after: $after, sortKey: TITLE) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          status
          variants(first: $variantsFirst) {
            nodes {
              id
              title
              sku
              price
              inventoryQuantity
            }
          }
        }
      }
    }`,
    {
      variables: {
        first: PRODUCTS_PER_PAGE,
        query: query || null,
        after: after || null,
        variantsFirst: VARIANTS_PER_PRODUCT,
      },
    },
  );
  const { data } = await response.json();

  const rows: VariantRow[] = [];
  for (const product of data.products.nodes) {
    for (const variant of product.variants.nodes) {
      rows.push({
        variantId: variant.id,
        productId: product.id,
        productTitle: product.title,
        variantTitle: variant.title === "Default Title" ? "" : variant.title,
        sku: variant.sku ?? "",
        price: variant.price,
        inventoryQuantity: variant.inventoryQuantity,
        status: product.status,
      });
    }
  }

  return {
    rows,
    hasNextPage: data.products.pageInfo.hasNextPage,
    endCursor: data.products.pageInfo.endCursor,
  };
}

interface MutationOutcome {
  applied: string[]; // variant ids
  failed: { variantId: string; error: string }[];
}

async function updateVariantPrices(
  graphql: AdminGraphql,
  productId: string,
  variants: { id: string; price: string }[],
): Promise<MutationOutcome> {
  const outcome: MutationOutcome = { applied: [], failed: [] };

  for (let i = 0; i < variants.length; i += VARIANTS_PER_MUTATION) {
    const chunk = variants.slice(i, i + VARIANTS_PER_MUTATION);
    try {
      const response = await graphql(
        `#graphql
        mutation BulkPilotUpdatePrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: true) {
            productVariants {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
        { variables: { productId, variants: chunk } },
      );
      const { data } = await response.json();
      const result = data.productVariantsBulkUpdate;
      const updatedIds = new Set(
        (result.productVariants ?? []).map((v: { id: string }) => v.id),
      );
      const errorMessage = (result.userErrors ?? [])
        .map((e: { message: string }) => e.message)
        .join("; ");
      for (const variant of chunk) {
        if (updatedIds.has(variant.id)) {
          outcome.applied.push(variant.id);
        } else {
          outcome.failed.push({
            variantId: variant.id,
            error: errorMessage || "Variant was not updated",
          });
        }
      }
    } catch (error) {
      for (const variant of chunk) {
        outcome.failed.push({
          variantId: variant.id,
          error: error instanceof Error ? error.message : "Request failed",
        });
      }
    }
  }

  return outcome;
}

function groupByProduct(changes: PriceChange[]): Map<string, PriceChange[]> {
  const groups = new Map<string, PriceChange[]>();
  for (const change of changes) {
    const group = groups.get(change.productId) ?? [];
    group.push(change);
    groups.set(change.productId, group);
  }
  return groups;
}

export async function applyBulkPriceChange(
  graphql: AdminGraphql,
  shop: string,
  label: string,
  changes: PriceChange[],
) {
  const operation = await prisma.bulkOperation.create({
    data: {
      shop,
      type: "PRICE",
      adjustment: label,
      status: "PENDING",
      itemCount: changes.length,
      items: {
        create: changes.map((change) => ({
          productId: change.productId,
          variantId: change.variantId,
          title: change.title,
          oldValue: change.oldPrice,
          newValue: change.newPrice,
          status: "PENDING",
        })),
      },
    },
  });

  let appliedCount = 0;
  for (const [productId, group] of groupByProduct(changes)) {
    const outcome = await updateVariantPrices(
      graphql,
      productId,
      group.map((c) => ({ id: c.variantId, price: c.newPrice })),
    );
    appliedCount += outcome.applied.length;
    await prisma.operationItem.updateMany({
      where: { operationId: operation.id, variantId: { in: outcome.applied } },
      data: { status: "APPLIED" },
    });
    for (const failure of outcome.failed) {
      await prisma.operationItem.updateMany({
        where: { operationId: operation.id, variantId: failure.variantId },
        data: { status: "FAILED", error: failure.error },
      });
    }
  }

  const status =
    appliedCount === changes.length
      ? "APPLIED"
      : appliedCount > 0
        ? "PARTIAL"
        : "FAILED";
  await prisma.bulkOperation.update({
    where: { id: operation.id },
    data: { status },
  });

  return { operationId: operation.id, appliedCount, total: changes.length, status };
}

export async function rollbackOperation(
  graphql: AdminGraphql,
  shop: string,
  operationId: string,
) {
  const operation = await prisma.bulkOperation.findFirst({
    where: { id: operationId, shop },
    include: { items: { where: { status: "APPLIED" } } },
  });
  if (!operation) {
    return { error: "Operation not found" };
  }
  if (operation.rolledBackAt) {
    return { error: "Operation was already rolled back" };
  }

  let restoredCount = 0;
  const byProduct = new Map<string, typeof operation.items>();
  for (const item of operation.items) {
    const group = byProduct.get(item.productId) ?? [];
    group.push(item);
    byProduct.set(item.productId, group);
  }

  for (const [productId, items] of byProduct) {
    const outcome = await updateVariantPrices(
      graphql,
      productId,
      items.map((item) => ({ id: item.variantId, price: item.oldValue })),
    );
    restoredCount += outcome.applied.length;
  }

  const total = operation.items.length;
  const fullyRestored = restoredCount === total;
  await prisma.bulkOperation.update({
    where: { id: operation.id },
    data: {
      status: fullyRestored ? "ROLLED_BACK" : "PARTIAL",
      rolledBackAt: fullyRestored ? new Date() : null,
    },
  });

  return { restoredCount, total };
}

export async function listOperations(shop: string) {
  return prisma.bulkOperation.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      items: {
        where: { status: "FAILED" },
        take: 5,
      },
    },
  });
}

export async function deleteShopData(shop: string) {
  await prisma.bulkOperation.deleteMany({ where: { shop } });
}
