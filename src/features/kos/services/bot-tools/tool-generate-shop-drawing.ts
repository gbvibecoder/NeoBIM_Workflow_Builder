/**
 * Bot tool: generate_shop_drawing (5I PR 2b — STUB).
 *
 * Real implementation is in 5J. For now we return a polite
 * "not implemented" message so the bot can tell the customer
 * truthfully + redirect to BOQ/formwork (which DO work).
 *
 * No sidecar call, no DB write, no S3 write. Pure return.
 */

export interface GenerateShopDrawingToolArgs {
  drawing_id: string;
}

export interface GenerateShopDrawingToolResult {
  status: "not_implemented";
  drawing_id: string;
  message: string;
}

export async function generateShopDrawingTool(
  args: GenerateShopDrawingToolArgs,
): Promise<GenerateShopDrawingToolResult> {
  return {
    status: "not_implemented",
    drawing_id: args.drawing_id ?? "",
    message:
      "Shop drawing generation is coming in 5J — it's not available yet. I can generate the BOQ and Formwork quantities for you now though. Want me to do that?",
  };
}
