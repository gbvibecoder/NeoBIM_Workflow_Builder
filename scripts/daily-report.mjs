#!/usr/bin/env node

/**
 * 🔥 DAILY REPORT AUTOMATION
 * Runs at 10 PM IST to generate and send daily analytics report
 * Usage: node scripts/daily-report.mjs [--send-telegram] [--send-email]
 */

import { PrismaClient } from "@prisma/client";
import fs from "fs/promises";
import path from "path";

const prisma = new PrismaClient();

async function getDashboardMetrics() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    signupsToday,
    activeUsers7d,
    totalWorkflows,
    totalExecutions,
    paidUsers,
    totalUsers,
  ] = await Promise.all([
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.user.count({ where: { updatedAt: { gte: sevenDaysAgo } } }),
    prisma.workflow.count(),
    prisma.execution.count(),
    prisma.user.count({ where: { role: { in: ["PRO", "TEAM_ADMIN"] } } }),
    prisma.user.count(),
  ]);

  const topSources = await getTopSources(today);
  const revenue = paidUsers * 79;
  const conversionRate = totalUsers > 0 ? (paidUsers / totalUsers) * 100 : 0;

  return {
    signupsToday,
    activeUsers7d,
    totalWorkflows,
    totalExecutions,
    revenue,
    conversionRate,
    topSources,
  };
}

async function getTopSources(since) {
  try {
    const logDir = path.join(process.cwd(), "analytics-logs");
    const files = await fs.readdir(logDir);
    const sources = new Map();

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const content = await fs.readFile(path.join(logDir, file), "utf-8");
      const lines = content.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (event.eventName === "user_signup" && event.source) {
            sources.set(event.source, (sources.get(event.source) || 0) + 1);
          }
        } catch {}
      }
    }

    return Array.from(sources.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  } catch {
    return [];
  }
}

async function generateReport() {
  const metrics = await getDashboardMetrics();
  const dayNumber = Math.floor(
    (Date.now() - new Date("2026-03-05").getTime()) / (24 * 60 * 60 * 1000)
  ) + 1;

  const report = `📊 Day ${dayNumber} Report:
✅ ${metrics.signupsToday} signups today
👥 ${metrics.activeUsers7d} active users (7-day)
🔧 ${metrics.totalWorkflows} workflows created
⚡ ${metrics.totalExecutions} executions run
💰 $${metrics.revenue} revenue (MRR)
📈 ${metrics.conversionRate.toFixed(1)}% conversion rate

Top Sources:
${metrics.topSources.map((s, i) => `${i + 1}. ${s.source}: ${s.count}`).join("\n") || "No sources yet"}`;

  return report;
}

async function sendToTelegram(report) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: report,
        parse_mode: "Markdown",
      }),
    });

    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.statusText}`);
    }

    console.log("✅ Report sent to Telegram");
    return true;
  } catch (error) {
    console.error("Failed to send to Telegram:", error);
    return false;
  }
}

async function main() {
  console.log("🔥 Generating daily analytics report...\n");

  const report = await generateReport();
  console.log(report);
  console.log("\n");

  // Check command line args
  const args = process.argv.slice(2);

  if (args.includes("--send-telegram")) {
    await sendToTelegram(report);
  }

  if (args.includes("--send-email")) {
    console.log("📧 Email sending not implemented yet");
  }

  // Save report to file
  const reportsDir = path.join(process.cwd(), "reports");
  await fs.mkdir(reportsDir, { recursive: true });
  const filename = `report-${new Date().toISOString().split("T")[0]}.txt`;
  await fs.writeFile(path.join(reportsDir, filename), report, "utf-8");
  console.log(`💾 Report saved to reports/${filename}`);

  await prisma.$disconnect();
}

main().catch(console.error);
