"use client"

import { useState } from "react"
import { ExternalLinkIcon, ChevronDownIcon, ChevronUpIcon, GlobeIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

interface WebsitePreviewCardProps {
  url: string
  title: string
  description: string
  domain: string
  image?: string
  favicon?: string
}

export function WebsitePreviewCard({ url, title, description, domain, image, favicon }: WebsitePreviewCardProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const isLongDescription = description.length > 150

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group mt-3 block overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-card to-card/50 transition-all hover:border-primary/40 hover:glow-purple"
    >
      {/* Preview Image */}
      {image && (
        <div className="relative aspect-video w-full overflow-hidden border-b border-primary/20 bg-black/20">
          <img
            src={image || "/placeholder.svg"}
            alt={title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </div>
      )}

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Title and favicon */}
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/50 ring-1 ring-border/50">
            {favicon ? (
              <img src={favicon || "/placeholder.svg"} alt="" className="h-5 w-5" />
            ) : (
              <GlobeIcon className="h-5 w-5 text-primary" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
              {title}
            </h3>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">{domain}</span>
              <ExternalLinkIcon className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="relative">
          <p
            className={`text-sm text-muted-foreground leading-relaxed ${
              !isExpanded && isLongDescription ? "line-clamp-2" : ""
            }`}
          >
            {description}
          </p>

          {/* Collapse toggle for long descriptions */}
          {isLongDescription && (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.preventDefault()
                setIsExpanded(!isExpanded)
              }}
              className="mt-2 h-auto gap-1 p-0 text-xs text-primary hover:text-primary/80"
            >
              {isExpanded ? (
                <>
                  Show less
                  <ChevronUpIcon className="h-3 w-3" />
                </>
              ) : (
                <>
                  Show more
                  <ChevronDownIcon className="h-3 w-3" />
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </a>
  )
}
