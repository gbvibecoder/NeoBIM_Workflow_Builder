"use client";

import { useEffect, useState } from "react";

interface DashboardMetrics {
  signupsToday: number;
  activeUsers7d: number;
  totalWorkflows: number;
  totalExecutions: number;
  revenue: number;
  conversionRate: number;
  topSources: Array<{ source: string; count: number }>;
}

export default function AnalyticsDashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  const fetchMetrics = async () => {
    try {
      const res = await fetch("/api/analytics");
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
        setLastUpdated(new Date());
      }
    } catch (error) {
      console.error("Failed to fetch analytics:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07070D] text-[#F0F0F5] flex items-center justify-center">
        <div className="text-lg">Loading analytics...</div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="min-h-screen bg-[#07070D] text-[#F0F0F5] flex items-center justify-center">
        <div className="text-lg">Unauthorized or no data available</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07070D] text-[#F0F0F5] p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">📊 Analytics Dashboard</h1>
          <div className="text-sm text-gray-400">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </div>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <MetricCard
            title="Signups Today"
            value={metrics.signupsToday}
            icon="✅"
            color="green"
          />
          <MetricCard
            title="Active Users (7d)"
            value={metrics.activeUsers7d}
            icon="👥"
            color="blue"
          />
          <MetricCard
            title="Workflows Created"
            value={metrics.totalWorkflows}
            icon="🔧"
            color="purple"
          />
          <MetricCard
            title="Executions Run"
            value={metrics.totalExecutions}
            icon="⚡"
            color="yellow"
          />
        </div>

        {/* Revenue & Conversion */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <MetricCard
            title="Monthly Recurring Revenue"
            value={`$${metrics.revenue}`}
            icon="💰"
            color="green"
          />
          <MetricCard
            title="Conversion Rate"
            value={`${metrics.conversionRate.toFixed(1)}%`}
            icon="📈"
            color="blue"
          />
        </div>

        {/* Top Sources */}
        <div className="bg-[#12121E] border border-white/[0.06] rounded-xl p-6">
          <h2 className="text-xl font-bold mb-4">Top Traffic Sources</h2>
          {metrics.topSources.length === 0 ? (
            <p className="text-gray-400">No signup sources tracked yet</p>
          ) : (
            <div className="space-y-3">
              {metrics.topSources.map((source, i) => (
                <div
                  key={source.source}
                  className="flex items-center justify-between p-3 bg-[#07070D] rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{i + 1}</span>
                    <span className="font-medium capitalize">{source.source}</span>
                  </div>
                  <span className="text-gray-400">{source.count} signups</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: string | number;
  icon: string;
  color: "green" | "blue" | "purple" | "yellow";
}) {
  const colorClasses = {
    green: "from-green-500/20 to-green-500/5 border-green-500/30",
    blue: "from-blue-500/20 to-blue-500/5 border-blue-500/30",
    purple: "from-purple-500/20 to-purple-500/5 border-purple-500/30",
    yellow: "from-yellow-500/20 to-yellow-500/5 border-yellow-500/30",
  };

  return (
    <div
      className={`bg-gradient-to-br ${colorClasses[color]} border rounded-xl p-6`}
    >
      <div className="flex items-center gap-3 mb-2">
        <span className="text-3xl">{icon}</span>
        <h3 className="text-sm text-gray-400 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="text-4xl font-bold">{value}</div>
    </div>
  );
}
