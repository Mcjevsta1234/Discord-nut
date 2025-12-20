"use client"

import { useState } from "react"
import { ChevronDownIcon, ListChecksIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface PlanCardProps {
  steps: string[]
}

export function PlanCard({ steps }: PlanCardProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  return (
    <div className="ml-11 overflow-hidden rounded-lg border border-primary/30 bg-primary/5 backdrop-blur-sm">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 p-3 text-left transition-colors hover:bg-primary/10"
      >
        <ListChecksIcon className="h-4 w-4 text-primary" />
        <span className="flex-1 text-sm font-medium text-foreground">Plan</span>
        <ChevronDownIcon
          className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")}
        />
      </button>
      {isExpanded && (
        <div className="border-t border-primary/20 p-3 animate-in slide-in-from-top-2 duration-200">
          <ul className="space-y-2">
            {steps.map((step, index) => (
              <li key={index} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-medium text-primary">
                  {index + 1}
                </span>
                <span className="text-muted-foreground leading-relaxed">{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
