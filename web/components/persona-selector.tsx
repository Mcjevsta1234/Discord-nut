"use client"

import { cn } from "@/lib/utils"
import { BrainIcon, CodeIcon, WandIcon } from "lucide-react"

type Persona = "emma" | "steve" | "wiz"

interface PersonaSelectorProps {
  value: Persona
  onChange: (persona: Persona) => void
}

const personas = [
  {
    id: "emma" as Persona,
    name: "Emma",
    icon: BrainIcon,
    description: "Creative & insightful",
    color: "text-purple-400",
  },
  {
    id: "steve" as Persona,
    name: "Steve",
    icon: CodeIcon,
    description: "Technical & precise",
    color: "text-violet-400",
  },
  {
    id: "wiz" as Persona,
    name: "Wiz",
    icon: WandIcon,
    description: "Magical & mysterious",
    color: "text-fuchsia-400",
  },
]

export function PersonaSelector({ value, onChange }: PersonaSelectorProps) {
  return (
    <div className="space-y-2">
      {personas.map((persona) => {
        const Icon = persona.icon
        const isActive = value === persona.id
        return (
          <button
            key={persona.id}
            onClick={() => onChange(persona.id)}
            className={cn(
              "w-full flex items-center gap-3 rounded-lg p-3 transition-all",
              "hover:bg-sidebar-accent",
              isActive && "bg-sidebar-accent ring-1 ring-primary/50 glow-purple",
            )}
          >
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md",
                isActive ? "bg-primary/20" : "bg-sidebar-border",
              )}
            >
              <Icon className={cn("h-4 w-4", isActive && persona.color)} />
            </div>
            <div className="flex-1 text-left">
              <p className={cn("text-sm font-medium", isActive ? "text-sidebar-foreground" : "text-muted-foreground")}>
                {persona.name}
              </p>
              <p className="text-xs text-muted-foreground">{persona.description}</p>
            </div>
            {isActive && <div className="h-2 w-2 rounded-full bg-primary animate-pulse"></div>}
          </button>
        )
      })}
    </div>
  )
}
