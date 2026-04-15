import React from "react";
import { cn } from "@/lib/utils";

/**
 * Lightweight skeleton loader for perceived performance
 * Much faster than animated loaders - shows content shape immediately
 */
export function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-slate-200/60",
        className
      )}
      {...props}
    />
  );
}

/**
 * Skeleton for CustomerCard - matches exact layout
 */
export function CustomerCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border-2 border-slate-200/60 bg-white/60 p-3">
      <div className="flex items-center gap-2">
        <Skeleton className="w-9 h-9 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
    </div>
  );
}

/**
 * Skeleton for QuickStats - matches 3-column grid
 */
export function QuickStatsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-2 mb-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl bg-slate-100 p-3">
          <Skeleton className="w-4 h-4 mb-1" />
          <Skeleton className="h-6 w-8 mb-1" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton for ServiceLogCard
 */
export function ServiceLogCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border-2 border-slate-200/60 bg-white/60 p-3">
      <div className="flex items-center gap-2">
        <Skeleton className="w-8 h-8 rounded-lg" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="w-8 h-8 rounded" />
      </div>
    </div>
  );
}

/**
 * Skeleton for customer detail header
 */
export function CustomerDetailSkeleton() {
  return (
    <div className="max-w-3xl mx-auto px-3 py-4">
      <Skeleton className="h-8 w-16 mb-3" />
      <div className="rounded-xl border-2 border-slate-200/60 bg-white p-4 mb-3">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-8 w-16 rounded-lg" />
          </div>
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-6 w-20 rounded-md" />
          <Skeleton className="h-6 w-16 rounded-md" />
          <Skeleton className="h-6 w-24 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-5 w-28 mb-3" />
      <div className="space-y-2">
        <ServiceLogCardSkeleton />
        <ServiceLogCardSkeleton />
        <ServiceLogCardSkeleton />
      </div>
    </div>
  );
}

/**
 * Skeleton for Pool Analysis Panel - matches the analysis layout
 */
export function PoolAnalysisSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center gap-3 mb-3">
        <Skeleton className="w-10 h-10 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mb-6">
        <Skeleton className="h-9 w-16 rounded-md" />
        <Skeleton className="h-9 w-16 rounded-md" />
        <Skeleton className="h-9 w-16 rounded-md" />
      </div>

      {/* Health Score Card skeleton */}
      <div className="rounded-xl border-2 border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-4">
          <Skeleton className="w-5 h-5 rounded" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="flex items-center justify-center gap-6 mb-4">
          {/* Score circle */}
          <Skeleton className="w-32 h-32 rounded-full" />
          {/* Score details */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>
        {/* Chemical breakdown grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-slate-50 p-3 rounded-lg text-center space-y-2">
              <Skeleton className="h-3 w-16 mx-auto" />
              <Skeleton className="h-6 w-10 mx-auto" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Predictive Insights skeleton */}
      <div className="rounded-xl border-2 border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-4">
          <Skeleton className="w-5 h-5 rounded" />
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="p-4 bg-slate-50 rounded-lg space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>

      {/* Trends skeleton */}
      <div className="rounded-xl border-2 border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-4">
          <Skeleton className="w-5 h-5 rounded" />
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-3 bg-slate-50 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
