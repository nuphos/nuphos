/** What Desktop may pass to ssh as the host: user@host, host or an ssh_config alias, then an optional :port. Never read as an ssh option. */
export const SSH_TARGET = /^(\w[\w.@-]*)(?::(\d{1,5}))?$/
