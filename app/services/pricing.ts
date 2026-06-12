// Pure pricing helpers shared by the editor UI (client) and the bulk apply
// service (server). Must stay free of server-only imports.

export type AdjustmentType =
  | "set"
  | "increase_percent"
  | "decrease_percent"
  | "increase_amount"
  | "decrease_amount"
  | "round_99";

export interface PriceChange {
  variantId: string;
  productId: string;
  title: string;
  oldPrice: string;
  newPrice: string;
}

export function computeNewPrice(
  oldPrice: string,
  type: AdjustmentType,
  value: number,
): string {
  const old = parseFloat(oldPrice);
  let next: number;
  switch (type) {
    case "set":
      next = value;
      break;
    case "increase_percent":
      next = old * (1 + value / 100);
      break;
    case "decrease_percent":
      next = old * (1 - value / 100);
      break;
    case "increase_amount":
      next = old + value;
      break;
    case "decrease_amount":
      next = old - value;
      break;
    case "round_99":
      next = Math.max(0.99, Math.round(old) - 0.01);
      break;
  }
  return Math.max(0, next).toFixed(2);
}

export function adjustmentLabel(type: AdjustmentType, value: number): string {
  switch (type) {
    case "set":
      return `Set price to ${value.toFixed(2)}`;
    case "increase_percent":
      return `Increase by ${value}%`;
    case "decrease_percent":
      return `Decrease by ${value}%`;
    case "increase_amount":
      return `Increase by ${value.toFixed(2)}`;
    case "decrease_amount":
      return `Decrease by ${value.toFixed(2)}`;
    case "round_99":
      return "Round to .99 endings";
  }
}
