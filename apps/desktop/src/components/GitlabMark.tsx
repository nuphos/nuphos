type Props = {
  size?: number
  className?: string
}

// GitLab "tanuki" logo (single-color, currentColor-fillable).
export function GitlabMark({ size = 16, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M23.6 9.593 23.566 9.504 20.3 0.978a0.851 0.851 0 0 0 -1.624 0.025l-2.2 6.74H7.524l-2.2 -6.74A0.85 0.85 0 0 0 3.7 0.978L0.435 9.5 0.4 9.593a5.978 5.978 0 0 0 1.983 6.911l0.012 0.009 0.029 0.022 4.9 3.671 2.426 1.836 1.478 1.117a1.006 1.006 0 0 0 1.214 0l1.478 -1.117 2.426 -1.836 4.93 -3.692 0.013 -0.011A5.98 5.98 0 0 0 23.6 9.593" />
    </svg>
  )
}
