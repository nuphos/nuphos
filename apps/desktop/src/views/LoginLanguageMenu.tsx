import { Check, Globe } from 'lucide-react'

import { Menu, MenuContent, MenuItem, MenuTrigger } from '../components/ui/menu'
import { LOCALES, locale, setLocale, t } from '../i18n'

/** The language before signing in, as iOS offers it on its sign-in screen; Settings keeps it after. */
export function LoginLanguageMenu() {
  const current = LOCALES.find((option) => option.code === locale)?.name ?? 'English'

  return (
    <Menu>
      <MenuTrigger
        aria-label={t('Language')}
        className="titlebar-no-drag flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold text-secondary transition-colors hover:bg-state-hover hover:text-main"
      >
        <Globe className="size-4" strokeWidth={1.8} />
        {current}
      </MenuTrigger>
      <MenuContent align="end" className="min-w-44">
        {LOCALES.map((option) => (
          <MenuItem
            key={option.code}
            hint={option.code === locale ? <Check className="size-3.5" /> : undefined}
            onClick={() => {
              if (option.code !== locale) setLocale(option.code)
            }}
          >
            {option.name}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}
