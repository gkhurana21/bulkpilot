import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { listOperations, rollbackOperation } from "../services/bulk.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const operations = await listOperations(session.shop);
  return { operations };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const operationId = String(formData.get("operationId"));
  const result = await rollbackOperation(
    admin.graphql,
    session.shop,
    operationId,
  );
  return result;
};

const STATUS_TONE: Record<string, "success" | "warning" | "critical" | "neutral"> = {
  APPLIED: "success",
  PARTIAL: "warning",
  FAILED: "critical",
  ROLLED_BACK: "neutral",
  PENDING: "neutral",
};

export default function History() {
  const { operations } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const isRollingBack = ["loading", "submitting"].includes(fetcher.state);

  useEffect(() => {
    if (fetcher.data && "restoredCount" in fetcher.data) {
      shopify.toast.show(
        `Restored ${fetcher.data.restoredCount} of ${fetcher.data.total} prices`,
      );
    } else if (fetcher.data && "error" in fetcher.data) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const rollback = (operationId: string) => {
    fetcher.submit({ operationId }, { method: "POST" });
  };

  return (
    <s-page heading="Bulk edit history">
      <s-section padding="none" accessibilityLabel="Operations table">
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Adjustment</s-table-header>
            <s-table-header>Date</s-table-header>
            <s-table-header format="numeric">Variants</s-table-header>
            <s-table-header listSlot="secondary">Status</s-table-header>
            <s-table-header>Actions</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {operations.map((operation) => {
              const canRollback =
                ["APPLIED", "PARTIAL"].includes(operation.status) &&
                !operation.rolledBackAt;
              return (
                <s-table-row key={operation.id}>
                  <s-table-cell>
                    <s-stack>
                      <s-text type="strong">{operation.adjustment}</s-text>
                      {operation.items.length > 0 && (
                        <s-text color="subdued">
                          {operation.items.length} failed item
                          {operation.items.length === 1 ? "" : "s"}:{" "}
                          {operation.items[0].error ?? "unknown error"}
                        </s-text>
                      )}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {new Date(operation.createdAt).toLocaleString()}
                  </s-table-cell>
                  <s-table-cell>{operation.itemCount}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONE[operation.status] ?? "neutral"}>
                      {operation.status.toLowerCase().replace("_", " ")}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {canRollback ? (
                      <s-button
                        variant="secondary"
                        tone="critical"
                        onClick={() => rollback(operation.id)}
                        {...(isRollingBack ? { disabled: true } : {})}
                      >
                        Roll back
                      </s-button>
                    ) : (
                      <s-text color="subdued">—</s-text>
                    )}
                  </s-table-cell>
                </s-table-row>
              );
            })}
          </s-table-body>
        </s-table>
        {operations.length === 0 && (
          <s-box padding="base">
            <s-paragraph>
              No bulk edits yet. Make one from the{" "}
              <s-link href="/app">editor</s-link> — every change lands here
              with a one-click rollback.
            </s-paragraph>
          </s-box>
        )}
      </s-section>

      <s-section slot="aside" heading="About rollbacks">
        <s-paragraph>
          BulkPilot snapshots the previous price of every variant it touches.
          Rolling back replays those snapshots, restoring each variant to its
          exact pre-edit price.
        </s-paragraph>
        <s-paragraph>
          Rollbacks only restore variants that were successfully changed by
          the original operation.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
