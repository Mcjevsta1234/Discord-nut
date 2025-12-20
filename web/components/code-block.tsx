"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { CheckIcon, CopyIcon } from "lucide-react"

interface CodeBlockProps {
  code: string
  language: string
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group relative my-4 overflow-hidden rounded-lg border border-primary/20 bg-black/40">
      <div className="flex items-center justify-between border-b border-primary/20 bg-black/20 px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{language}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={copyToClipboard}
          className="h-7 gap-1.5 text-xs opacity-0 transition-opacity group-hover:opacity-100"
        >
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
      <div className="overflow-x-auto p-4">
        <pre className="text-sm">
          <code className="font-mono text-foreground">{code}</code>
        </pre>
      </div>
    </div>
  )
}
