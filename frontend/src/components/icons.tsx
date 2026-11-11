import type { ReactNode } from 'react'

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

interface IconProps {
  size?: number
}

export function CalculatorIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="5" y="3" width="14" height="18" rx="3" />
      <path d="M9 7.5h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01" />
    </Icon>
  )
}

export function CopyIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
    </Icon>
  )
}

export function PinIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M12 16v5M9 3h6l-.8 6 2.8 3v2H7v-2l2.8-3L9 3z" />
    </Icon>
  )
}

export function TrashIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </Icon>
  )
}

export function CloseIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  )
}

export function BackspaceIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM17 9.5l-5 5M12 9.5l5 5" />
    </Icon>
  )
}

export function BookmarkIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" />
    </Icon>
  )
}

export function AlertIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </Icon>
  )
}

export function ArrowUpLeftIcon({ size }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M17 17L7 7M7 15V7h8" />
    </Icon>
  )
}
