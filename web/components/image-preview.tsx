"use client"

import { useState } from "react"
import { XIcon } from "lucide-react"
import Image from "next/image"

interface ImagePreviewProps {
  src: string
  alt: string
  caption?: string
}

export function ImagePreview({ src, alt, caption }: ImagePreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <>
      <div className="mt-4 space-y-2">
        <button
          onClick={() => setIsExpanded(true)}
          className="relative overflow-hidden rounded-lg border border-primary/20 transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10"
        >
          <Image src={src || "/placeholder.svg"} alt={alt} width={600} height={400} className="w-full object-cover" />
        </button>
        {caption && <p className="text-xs text-muted-foreground italic">{caption}</p>}
      </div>

      {/* Expanded view modal */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setIsExpanded(false)}
        >
          <button
            className="absolute right-4 top-4 rounded-full bg-card p-2 hover:bg-muted"
            onClick={() => setIsExpanded(false)}
          >
            <XIcon className="h-5 w-5" />
          </button>
          <Image
            src={src || "/placeholder.svg"}
            alt={alt}
            width={1200}
            height={800}
            className="max-h-[90vh] w-auto rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
