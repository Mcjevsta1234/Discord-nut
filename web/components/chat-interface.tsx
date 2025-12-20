"use client"

import { useState, useRef, useEffect } from "react"
import { PersonaSelector } from "@/components/persona-selector"
import { ChatMessage } from "@/components/chat-message"
import { ChatInput } from "@/components/chat-input"
import { WebsitePreviewCard } from "@/components/website-preview-card"
import { CodePreviewBlock } from "@/components/code-preview-block"
import { Button } from "@/components/ui/button"
import { PlusIcon, SparklesIcon, MessageSquareIcon } from "lucide-react"

type Persona = "emma" | "steve" | "wiz"

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

type ChatHistory = {
  id: string
  title: string
  timestamp: Date
}

const mockMessages: Message[] = [
  {
    id: "1",
    role: "user",
    content: "Can you show me how to create a React component with TypeScript?",
    timestamp: new Date(Date.now() - 15000),
  },
  {
    id: "2",
    role: "assistant",
    content: `I'll create a reusable button component with TypeScript. This demonstrates props, variants, and proper typing.`,
    plan: [
      "Define TypeScript interface for component props",
      "Create the component with proper type safety",
      "Add variant support for different button styles",
    ],
    codePreview: {
      filename: "button.tsx",
      language: "typescript",
      code: `import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'rounded-lg font-medium transition-colors',
          {
            'bg-primary text-white hover:bg-primary/90': variant === 'primary',
            'bg-secondary text-foreground hover:bg-secondary/80': variant === 'secondary',
            'hover:bg-muted': variant === 'ghost',
            'px-3 py-1.5 text-sm': size === 'sm',
            'px-4 py-2': size === 'md',
            'px-6 py-3 text-lg': size === 'lg',
          },
          className
        )}
        {...props}
      />
    )
  }
)

Button.displayName = 'Button'`,
    },
    timestamp: new Date(Date.now() - 13000),
  },
  {
    id: "3",
    role: "user",
    content: "What's the best resource for learning Next.js?",
    timestamp: new Date(Date.now() - 8000),
  },
  {
    id: "4",
    role: "assistant",
    content: `The official Next.js documentation is the best place to start. It's comprehensive, regularly updated, and includes interactive examples.`,
    plan: ["Identify the most authoritative resource", "Provide context on why it's valuable"],
    websitePreview: {
      url: "https://nextjs.org/docs",
      title: "Getting Started: Introduction | Next.js",
      description:
        "Learn about Next.js features and API. Get started with the App Router, Pages Router, and explore advanced concepts like Server Components, streaming, and more.",
      domain: "nextjs.org",
      image: "/next-js-documentation-hero.jpg",
      favicon: "/nextjs-logo.png",
    },
    timestamp: new Date(Date.now() - 6000),
  },
]

const mockHistory: ChatHistory[] = [
  { id: "1", title: "React TypeScript Component", timestamp: new Date(Date.now() - 300000) },
  { id: "2", title: "Next.js Documentation", timestamp: new Date(Date.now() - 600000) },
  { id: "3", title: "API Route Handlers", timestamp: new Date(Date.now() - 86400000) },
]

export default function ChatInterface() {
  const [persona, setPersona] = useState<Persona>("emma")
  const [messages, setMessages] = useState<Message[]>(mockMessages)
  const [isLoading, setIsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [selectedPreview, setSelectedPreview] = useState<Message | null>(null)

  useEffect(() => {
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.role === "assistant" && (lastMessage.websitePreview || lastMessage.codePreview)) {
      setSelectedPreview(lastMessage)
    }
  }, [messages])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = (content: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date(),
    }
    setMessages([...messages, userMessage])
    setIsLoading(true)

    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "This is a demo response. In production, this would connect to your AI backend.",
        plan: ["Process your request", "Generate appropriate response", "Format and deliver the answer"],
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, assistantMessage])
      setIsLoading(false)
    }, 2000)
  }

  const handleNewChat = () => {
    setMessages([])
    setSelectedPreview(null)
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Left Sidebar - Chat History */}
      <aside className="flex w-64 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
          <SparklesIcon className="h-6 w-6 text-primary" />
          <h1 className="text-lg font-semibold text-sidebar-foreground">Witchy AI</h1>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <Button
            onClick={handleNewChat}
            className="w-full justify-start gap-2 bg-primary text-primary-foreground hover:bg-primary/90 glow-purple"
          >
            <PlusIcon className="h-4 w-4" />
            New Chat
          </Button>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Persona</p>
            <PersonaSelector value={persona} onChange={setPersona} />
          </div>

          <div className="space-y-2 flex-1 overflow-hidden">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">History</p>
            <div className="space-y-1 overflow-y-auto chat-scrollbar max-h-96">
              {mockHistory.map((chat) => (
                <button
                  key={chat.id}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-sidebar-accent transition-colors group"
                >
                  <div className="flex items-start gap-2">
                    <MessageSquareIcon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-sidebar-foreground truncate group-hover:text-primary transition-colors">
                        {chat.title}
                      </p>
                      <p className="text-xs text-muted-foreground">{chat.timestamp.toLocaleDateString()}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-auto border-t border-sidebar-border p-4">
          <div className="rounded-lg bg-sidebar-accent p-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-sidebar-foreground">{messages.length}</span> messages in this chat
            </p>
          </div>
        </div>
      </aside>

      {/* Main chat area */}
      <main className="flex flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-8 chat-scrollbar">
          <div className="mx-auto w-full max-w-3xl space-y-6">
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center space-y-4">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 glow-purple-strong">
                    <SparklesIcon className="h-8 w-8 text-primary" />
                  </div>
                  <h2 className="text-2xl font-semibold text-foreground">Start a new conversation</h2>
                  <p className="text-muted-foreground max-w-md">
                    Ask {persona === "emma" ? "Emma" : persona === "steve" ? "Steve" : "Wiz"} anything. I'm here to help
                    with code, ideas, and more.
                  </p>
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <ChatMessage key={message.id} message={message} onPreviewClick={setSelectedPreview} />
              ))
            )}
            {isLoading && (
              <div className="flex items-center gap-3 text-muted-foreground">
                <div className="flex gap-1">
                  <div className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]"></div>
                  <div className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]"></div>
                  <div className="h-2 w-2 animate-bounce rounded-full bg-primary"></div>
                </div>
                <span className="text-sm">Thinking...</span>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border bg-card/50 backdrop-blur-sm">
          <div className="mx-auto w-full max-w-3xl p-4">
            <ChatInput onSend={handleSend} persona={persona} disabled={isLoading} />
          </div>
        </div>
      </main>

      {/* Right sidebar - Previews */}
      {selectedPreview && (
        <aside className="flex w-96 flex-col border-l border-sidebar-border bg-sidebar overflow-hidden">
          <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
            <h2 className="text-sm font-semibold text-sidebar-foreground">Preview</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 chat-scrollbar">
            {selectedPreview.websitePreview && (
              <WebsitePreviewCard
                url={selectedPreview.websitePreview.url}
                title={selectedPreview.websitePreview.title}
                description={selectedPreview.websitePreview.description}
                domain={selectedPreview.websitePreview.domain}
                image={selectedPreview.websitePreview.image}
                favicon={selectedPreview.websitePreview.favicon}
              />
            )}
            {selectedPreview.codePreview && (
              <CodePreviewBlock
                code={selectedPreview.codePreview.code}
                language={selectedPreview.codePreview.language}
                filename={selectedPreview.codePreview.filename}
              />
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
