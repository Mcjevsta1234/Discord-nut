"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { CheckIcon, CopyIcon, ChevronDownIcon, ChevronUpIcon, FileCodeIcon } from "lucide-react"

interface CodePreviewBlockProps {
  code: string
  language: string
  filename?: string
}

export function CodePreviewBlock({ code, language, filename }: CodePreviewBlockProps) {
  const [copied, setCopied] = useState(false)
  const [isExpanded, setIsExpanded] = useState(true)

  const lines = code.split("\n")
  const isLongCode = lines.length > 15

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group my-4 overflow-hidden rounded-xl border border-primary/20 bg-black/40 transition-all hover:border-primary/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-primary/20 bg-black/20 px-4 py-2.5">
        <div className="flex items-center gap-3">
          {filename ? (
            <div className="flex items-center gap-2">
              <FileCodeIcon className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">{filename}</span>
            </div>
          ) : (
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{language}</span>
          )}
          <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20">
            {language}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Collapse toggle for long code */}
          {isLongCode && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-7 gap-1.5 text-xs"
            >
              {isExpanded ? (
                <>
                  <ChevronUpIcon className="h-3 w-3" />
                  Collapse
                </>
              ) : (
                <>
                  <ChevronDownIcon className="h-3 w-3" />
                  Expand
                </>
              )}
            </Button>
          )}

          {/* Copy button */}
          <Button size="sm" variant="ghost" onClick={copyToClipboard} className="h-7 gap-1.5 text-xs">
            {copied ? (
              <>
                <CheckIcon className="h-3 w-3" />
                Copied
              </>
            ) : (
              <>
                <CopyIcon className="h-3 w-3" />
                Copy
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Code content */}
      <div className={`overflow-x-auto transition-all ${isExpanded ? "max-h-[600px]" : "max-h-[200px]"}`}>
        <div className="p-4">
          <pre className="text-sm">
            <code className="font-mono text-foreground">{code}</code>
          </pre>
        </div>
      </div>

      {/* Fade overlay when collapsed */}
      {isLongCode && !isExpanded && (
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-black/60 to-transparent" />
      )}
    </div>
  )
}
