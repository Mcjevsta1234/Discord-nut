"use client"

import type React from "react"

import { useState, useRef, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { SendIcon } from "lucide-react"

type Persona = "emma" | "steve" | "wiz"

interface ChatInputProps {
  onSend: (message: string) => void
  persona: Persona
  disabled?: boolean
}

const placeholders: Record<Persona, string> = {
  emma: "Ask Emma something...",
  steve: "Ask Steve something...",
  wiz: "Ask Wiz something...",
}

export function ChatInput({ onSend, persona, disabled }: ChatInputProps) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = () => {
    if (value.trim() && !disabled) {
      onSend(value.trim())
      setValue("")
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"
      }
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    e.target.style.height = "auto"
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px"
  }

  return (
    <div className="relative flex items-end gap-2 rounded-xl border border-border bg-card p-2 transition-all focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 glow-purple">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={placeholders[persona]}
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
        style={{ maxHeight: "200px" }}
      />
      <Button
        onClick={handleSubmit}
        disabled={!value.trim() || disabled}
        size="icon"
        className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        <SendIcon className="h-4 w-4" />
      </Button>
    </div>
  )
}
