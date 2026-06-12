import { useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  adjustmentLabel,
  applyBulkPriceChange,
  computeNewPrice,
  fetchVariants,
  type AdjustmentType,
  type PriceChange,
} from "../services/bulk.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const after = url.searchParams.get("after") ?? "";
  const page = await fetchVariants(admin.graphql, { query, after });
  return { ...page, query };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const changes: PriceChange[] = JSON.parse(String(formData.get("changes")));
  const label = String(formData.get("label"));

  if (changes.length === 0) {
    return { error: "No price changes to apply" };
  }

  const result = await applyBulkPriceChange(
    admin.graphql,
    session.shop,
    label,
    changes,
  );
  return { result };
};

const ADJUSTMENT_OPTIONS: { value: AdjustmentType; label: string }[] = [
  { value: "decrease_percent", label: "Decrease by %" },
  { value: "increase_percent", label: "Increase by %" },
  { value: "decrease_amount", label: "Decrease by amount" },
  { value: "increase_amount", label: "Increase by amount" },
  { value: "set", label: "Set price to" },
  { value: "round_99", label: "Round to .99 endings" },
];

export default function Index() {
  const { rows, hasNextPage, endCursor, query } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [search, setSearch] = useState(query);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adjustType, setAdjustType] = useState<AdjustmentType>(
    "decrease_percent",
  );
  const [adjustValue, setAdjustValue] = useState("10");

  const isApplying =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const value = parseFloat(adjustValue);
  const valueValid = adjustType === "round_99" || (!isNaN(value) && value >= 0);

  const changes: PriceChange[] = useMemo(() => {
    if (!valueValid) return [];
    return rows
      .filter((row) => selected.has(row.variantId))
      .map((row) => ({
        variantId: row.variantId,
        productId: row.productId,
        title: row.variantTitle
          ? `${row.productTitle} — ${row.variantTitle}`
          : row.productTitle,
        oldPrice: row.price,
        newPrice: computeNewPrice(row.price, adjustType, value || 0),
      }))
      .filter((change) => change.newPrice !== change.oldPrice);
  }, [rows, selected, adjustType, value, valueValid]);

  const newPriceByVariant = useMemo(() => {
    const map = new Map<string, string>();
    for (const change of changes) map.set(change.variantId, change.newPrice);
    return map;
  }, [changes]);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    setSelected(
      allSelected ? new Set() : new Set(rows.map((row) => row.variantId)),
    );
  };

  const toggleRow = (variantId: string) => {
    const next = new Set(selected);
    if (next.has(variantId)) {
      next.delete(variantId);
    } else {
      next.add(variantId);
    }
    setSelected(next);
  };

  const runSearch = () => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    setSelected(new Set());
    navigate(`/app?${params.toString()}`);
  };

  const nextPage = () => {
    const params = new URLSearchParams(searchParams);
    if (endCursor) params.set("after", endCursor);
    setSelected(new Set());
    navigate(`/app?${params.toString()}`);
  };

  const apply = () => {
    fetcher.submit(
      {
        changes: JSON.stringify(changes),
        label: adjustmentLabel(adjustType, value || 0),
      },
      { method: "POST" },
    );
    shopify.modal?.hide?.("confirm-apply");
  };

  const result = fetcher.data && "result" in fetcher.data ? fetcher.data.result : null;

  return (
    <s-page heading="BulkPilot — Bulk Price Editor">
      <s-button
        slot="primary-action"
        variant="primary"
        commandFor="confirm-apply"
        command="--show"
        {...(changes.length === 0 || isApplying ? { disabled: true } : {})}
      >
        {isApplying
          ? "Applying…"
          : `Preview & apply (${changes.length})`}
      </s-button>

      {result && (
        <s-banner
          tone={result.status === "APPLIED" ? "success" : "warning"}
          heading={
            result.status === "APPLIED"
              ? `Updated ${result.appliedCount} variant prices`
              : `Applied ${result.appliedCount} of ${result.total} changes`
          }
        >
          <s-paragraph>
            Every change is snapshotted —{" "}
            <s-link href="/app/history">view history & roll back</s-link>.
          </s-paragraph>
        </s-banner>
      )}

      <s-section heading="Adjustment">
        <s-stack direction="inline" gap="base" alignItems="end">
          <s-select
            label="Action"
            value={adjustType}
            onChange={(event) =>
              setAdjustType(
                (event.target as HTMLSelectElement).value as AdjustmentType,
              )
            }
          >
            {ADJUSTMENT_OPTIONS.map((option) => (
              <s-option key={option.value} value={option.value}>
                {option.label}
              </s-option>
            ))}
          </s-select>
          {adjustType !== "round_99" && (
            <s-number-field
              label={
                adjustType.endsWith("percent") ? "Percent" : "Amount"
              }
              value={adjustValue}
              min={0}
              onChange={(event) =>
                setAdjustValue((event.target as HTMLInputElement).value)
              }
            />
          )}
          <s-text color="subdued">
            {selected.size} selected · {changes.length} will change
          </s-text>
        </s-stack>
      </s-section>

      <s-section padding="none" accessibilityLabel="Variants table">
        <s-table>
          <s-grid
            slot="filters"
            gap="small-200"
            gridTemplateColumns="1fr auto"
          >
            <s-search-field
              label="Search products"
              labelAccessibilityVisibility="exclusive"
              placeholder='Search (e.g. winter, vendor:Acme, tag:sale)'
              value={search}
              onChange={(event) =>
                setSearch((event.target as HTMLInputElement).value)
              }
            />
            <s-button variant="secondary" onClick={runSearch}>
              Search
            </s-button>
          </s-grid>

          <s-table-header-row>
            <s-table-header listSlot="primary">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-checkbox
                  accessibilityLabel="Select all variants"
                  {...(allSelected ? { checked: true } : {})}
                  {...(someSelected ? { indeterminate: true } : {})}
                  onChange={toggleAll}
                />
                <s-text>Product</s-text>
              </s-stack>
            </s-table-header>
            <s-table-header>SKU</s-table-header>
            <s-table-header listSlot="secondary">Status</s-table-header>
            <s-table-header format="numeric">Inventory</s-table-header>
            <s-table-header format="numeric">Current price</s-table-header>
            <s-table-header format="numeric">New price</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {rows.map((row) => {
              const newPrice = newPriceByVariant.get(row.variantId);
              return (
                <s-table-row key={row.variantId}>
                  <s-table-cell>
                    <s-stack
                      direction="inline"
                      gap="small"
                      alignItems="center"
                    >
                      <s-checkbox
                        accessibilityLabel={`Select ${row.productTitle}`}
                        {...(selected.has(row.variantId)
                          ? { checked: true }
                          : {})}
                        onChange={() => toggleRow(row.variantId)}
                      />
                      <s-text>
                        {row.productTitle}
                        {row.variantTitle ? ` — ${row.variantTitle}` : ""}
                      </s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{row.sku || "—"}</s-table-cell>
                  <s-table-cell>
                    <s-badge
                      tone={row.status === "ACTIVE" ? "success" : "neutral"}
                    >
                      {row.status.toLowerCase()}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{row.inventoryQuantity ?? "—"}</s-table-cell>
                  <s-table-cell>{row.price}</s-table-cell>
                  <s-table-cell>
                    {newPrice ? (
                      <s-text fontWeight="bold">{newPrice}</s-text>
                    ) : (
                      <s-text color="subdued">—</s-text>
                    )}
                  </s-table-cell>
                </s-table-row>
              );
            })}
          </s-table-body>
        </s-table>
        {rows.length === 0 && (
          <s-box padding="base">
            <s-paragraph>
              No products matched. Try a different search, or clear it to see
              all products.
            </s-paragraph>
          </s-box>
        )}
        {hasNextPage && (
          <s-box padding="base">
            <s-button variant="secondary" onClick={nextPage}>
              Next page
            </s-button>
          </s-box>
        )}
      </s-section>

      <s-section slot="aside" heading="How it works">
        <s-paragraph>
          Select variants, choose an adjustment, and preview the new prices in
          the table before anything is written.
        </s-paragraph>
        <s-paragraph>
          Every applied change snapshots the previous price, so any bulk edit
          can be rolled back in one click from{" "}
          <s-link href="/app/history">History</s-link>.
        </s-paragraph>
      </s-section>

      <s-modal id="confirm-apply" heading={`Apply ${changes.length} price changes?`}>
        <s-paragraph>
          {adjustmentLabel(adjustType, value || 0)} on {changes.length}{" "}
          variant{changes.length === 1 ? "" : "s"}. Previous prices are
          snapshotted and can be rolled back from History.
        </s-paragraph>
        <s-button slot="primary-action" variant="primary" onClick={apply}>
          Apply changes
        </s-button>
        <s-button
          slot="secondary-actions"
          commandFor="confirm-apply"
          command="--hide"
        >
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
