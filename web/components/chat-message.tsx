"use client"
import { PlanCard } from "@/components/plan-card"
import { ImagePreview } from "@/components/image-preview"
import { UserIcon, SparklesIcon } from "lucide-react"
import ReactMarkdown from "react-markdown"
import { CodeBlock } from "@/components/code-block"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  plan?: string[]
  timestamp: Date
  image?: string
  websitePreview?: {
    url: string
    title: string
    description: string
    domain: string
    image?: string
    favicon?: string
  }
  codePreview?: {
    code: string
    language: string
    filename?: string
  }
}

interface ChatMessageProps {
  message: Message
  onPreviewClick?: (message: Message) => void
}

export function ChatMessage({ message, onPreviewClick }: ChatMessageProps) {
  const isUser = message.role === "user"

  return (
    <div className="group space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full ${
            isUser ? "bg-muted" : "bg-gradient-to-br from-purple-500/20 to-fuchsia-500/20 ring-1 ring-primary/30"
          }`}
        >
          {isUser ? (
            <UserIcon className="h-4 w-4 text-foreground" />
          ) : (
            <SparklesIcon className="h-4 w-4 text-primary" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{isUser ? "You" : "Assistant"}</span>
          <span className="text-xs text-muted-foreground">
            {message.timestamp.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>

      {!isUser && message.plan && <PlanCard steps={message.plan} />}

      <div
        className={`rounded-xl p-4 ${
          isUser ? "bg-muted/50 ml-11" : "bg-gradient-to-br from-card to-card/50 ring-1 ring-border/50 ml-11"
        }`}
      >
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown
            components={{
              code: ({ className, children, ...props }) => {
                const match = /language-(\w+)/.exec(className || "")
                const isInline = !match

                if (isInline) {
                  return (
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground" {...props}>
                      {children}
                    </code>
                  )
                }

                return <CodeBlock language={match[1]} code={String(children).replace(/\n$/, "")} />
              },
              p: ({ children }) => <p className="leading-relaxed text-foreground">{children}</p>,
              h1: ({ children }) => <h1 className="text-foreground">{children}</h1>,
              h2: ({ children }) => <h2 className="text-foreground">{children}</h2>,
              h3: ({ children }) => <h3 className="text-foreground">{children}</h3>,
              ul: ({ children }) => <ul className="text-foreground">{children}</ul>,
              ol: ({ children }) => <ol className="text-foreground">{children}</ol>,
              li: ({ children }) => <li className="text-foreground">{children}</li>,
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

        {message.image && <ImagePreview src={message.image || "/placeholder.svg"} alt="Generated image" />}
      </div>
    </div>
  )
}
