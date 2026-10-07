import "server-only";

import { createUIMessageStream, generateId } from "ai";

import { searchVenueCatalogue } from "@/lib/ai/chat-tools";
import { runBudgetForecast, runSpendAnalysis, type AnalyticsScope } from "@/lib/analytics/service";
import { formatINR } from "@/lib/utils";
import type { LuferUIMessage } from "@/types/chat";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Scripted reply used when OPENAI_API_KEY isn't set, so the workspace still
 * shows streaming text, a real tool call and a code block end to end. The tool
 * genuinely runs; only the decision to call it and the prose are canned.
 */
export function demoChatStream(prompt: string, scope: AnalyticsScope) {
  if (/\b(budget|forecast|project(ed|ion)?|run out|on track)\b/i.test(prompt)) return demoFinanceStream("forecastBudget", scope);
  if (/\b(spend|spent|spending|cost|costs|gst|savings|expenses?)\b/i.test(prompt)) return demoFinanceStream("analyzeSpend", scope);
  const guests = Number(prompt.match(/\b(\d{1,4})\b/)?.[1] ?? 20);
  const input = { location: "", minCapacity: guests, maxBudgetPerHead: 0, features: [] as string[] };

  return createUIMessageStream<LuferUIMessage>({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageMetadata: { model: "demo", demo: true } });

      // Step 1: tool call.
      writer.write({ type: "start-step" });
      const toolCallId = generateId();
      writer.write({ type: "tool-input-start", toolCallId, toolName: "searchVenues" });
      await sleep(400);
      writer.write({ type: "tool-input-available", toolCallId, toolName: "searchVenues", input });
      await sleep(700);
      const output = await searchVenueCatalogue(input);
      writer.write({ type: "tool-output-available", toolCallId, output });
      writer.write({ type: "finish-step" });

      // Step 2: streamed answer.
      writer.write({ type: "start-step" });
      const names = output.venues.map((v) => `- **${v.name}** (${v.neighborhood}) · up to ${v.capacity} guests`).join("\n");
      const text = [
        `**Demo mode:** no model is configured, so this reply is scripted. The tool call above is real: it searched the catalogue for venues holding ${guests}+ guests and found ${output.total}.`,
        "",
        names || "_No venues matched._",
        "",
        "To chat with a live model, add an OpenAI key on the **Settings** page, or put it in `.env.local` yourself:",
        "",
        "```bash",
        "OPENAI_API_KEY=sk-...",
        "# optional",
        "OPENAI_MODEL=gpt-6.1-sol",
        "```",
      ].join("\n");

      const id = generateId();
      writer.write({ type: "text-start", id });
      for (const chunk of text.match(/\S+\s*/g) ?? []) {
        writer.write({ type: "text-delta", id, delta: chunk });
        await sleep(18);
      }
      writer.write({ type: "text-end", id });
      writer.write({ type: "finish-step" });
      writer.write({ type: "finish" });
    },
  });
}

const DEMO_NOTE =
  "**Demo mode:** no model is configured, so this reply is scripted. The tool call above is real and ran against live booking data.";

/** Scripted finance reply: runs the real analytics tool for the caller's scope, then summarises it. */
function demoFinanceStream(toolName: "analyzeSpend" | "forecastBudget", scope: AnalyticsScope) {
  return createUIMessageStream<LuferUIMessage>({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageMetadata: { model: "demo", demo: true } });
      writer.write({ type: "start-step" });
      const toolCallId = generateId();
      writer.write({ type: "tool-input-start", toolCallId, toolName });
      await sleep(300);

      let text: string;
      if (toolName === "analyzeSpend") {
        const input = { period: "fytd" as const, groupBy: "month" as const };
        writer.write({ type: "tool-input-available", toolCallId, toolName, input });
        const output = await runSpendAnalysis(scope, input);
        writer.write({ type: "tool-output-available", toolCallId, output });
        text =
          "error" in output
            ? output.error
            : [
                DEMO_NOTE,
                "",
                `**${output.scope}, ${output.period.label}:** ${formatINR(output.totals.spend)} pre-GST across ${output.totals.bookings} bookings ` +
                  `(${formatINR(output.totals.gst)} GST, reclaimable as ITC; ${formatINR(output.totals.savings)} saved through rate cards).`,
                "",
                "| Month | Bookings | Spend |",
                "| --- | ---: | ---: |",
                ...output.rows.map((r) => `| ${r.key} | ${r.bookings} | ${formatINR(r.spend)} |`),
              ].join("\n");
      } else {
        const input = {};
        writer.write({ type: "tool-input-available", toolCallId, toolName, input });
        const output = await runBudgetForecast(scope, input);
        writer.write({ type: "tool-output-available", toolCallId, output });
        if ("error" in output) {
          text = output.error;
        } else {
          const b = output.budget;
          text = [
            DEMO_NOTE,
            "",
            `**${output.scope}, ${output.period.label}:** projected ${formatINR(output.projectedPeriodTotal)} pre-GST (${output.basis}).`,
            b
              ? `Against ${b.source} of ${formatINR(b.budget)}: ${b.projectedUtilisationPct}% used by year end, **${b.status.replace("_", " ")}**` +
                (b.exhaustionMonth ? `, running out in ${b.exhaustionMonth}.` : ".")
              : "No budget to compare against: ask with an amount, or name a department that has one.",
          ].join("\n");
        }
      }
      writer.write({ type: "finish-step" });

      writer.write({ type: "start-step" });
      const id = generateId();
      writer.write({ type: "text-start", id });
      for (const chunk of text.match(/\S+\s*/g) ?? []) {
        writer.write({ type: "text-delta", id, delta: chunk });
        await sleep(14);
      }
      writer.write({ type: "text-end", id });
      writer.write({ type: "finish-step" });
      writer.write({ type: "finish" });
    },
  });
}
