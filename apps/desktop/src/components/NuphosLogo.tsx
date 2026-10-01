type Props = {
  className?: string
  variant?: 'dark-bg' | 'white-bg'
}

export function NuphosLogo({ className, variant = 'dark-bg' }: Props) {
  return (
    <img
      className={className}
      src={variant === 'dark-bg' ? '/logo-dark-bg.svg' : '/logo-white-bg.svg'}
      alt=""
      aria-hidden="true"
    />
  )
}
