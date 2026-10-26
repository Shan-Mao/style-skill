import type { SVGProps } from 'react'

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number
}

function Svg({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function BrandMark(props: IconProps) {
  return (
    <Svg strokeWidth={1.8} {...props}>
      <rect x="3.25" y="3.25" width="17.5" height="17.5" rx="4.5" />
      <path d="M8.5 15.5l7-7" />
      <circle cx="10.4" cy="10.4" r="1.3" />
      <circle cx="13.6" cy="13.6" r="1.3" />
    </Svg>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.75 6.75c0-.97.78-1.75 1.75-1.75h3.5c.55 0 1.07.26 1.4.7l.9 1.2c.33.44.85.7 1.4.7h6.55c.97 0 1.75.78 1.75 1.75v8.1c0 .97-.78 1.75-1.75 1.75H5.5c-.97 0-1.75-.78-1.75-1.75z" />
    </Svg>
  )
}

export function ImageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2.25" />
      <circle cx="9" cy="9.75" r="1.5" />
      <path d="M6.75 17.75l5.2-5.2a1.9 1.9 0 0 1 2.68 0l5.62 5.62" />
    </Svg>
  )
}

export function SlidersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6.5h8.7M17.3 6.5H20" />
      <circle cx="15" cy="6.5" r="1.9" />
      <path d="M4 12h1.7M10.3 12H20" />
      <circle cx="8" cy="12" r="1.9" />
      <path d="M4 17.5h5.7M14.3 17.5H20" />
      <circle cx="12" cy="17.5" r="1.9" />
    </Svg>
  )
}

export function PackageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.2l8.25 4.2v9.2L12 20.8l-8.25-4.2V7.4z" />
      <path d="M3.75 7.4L12 11.6l8.25-4.2" />
      <path d="M12 11.6v9.2" />
    </Svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5.5v13M5.5 12h13" />
    </Svg>
  )
}

export function UploadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 14.5v-10M8.25 8.25L12 4.5l3.75 3.75" />
      <path d="M4.75 16.5v1.75c0 1.1.9 2 2 2h10.5c1.1 0 2-.9 2-2V16.5" />
    </Svg>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.25 6.25L15 12l-5.75 5.75" />
    </Svg>
  )
}

export function XIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Svg>
  )
}
