# Bot task mode evidence

These images use synthetic data only. They render the production `BotTaskButton`
and `BotTaskMode` components with the production stylesheet in an isolated Vite
harness. The transcript is a synthetic stand-in for `AgentPanel`; the sidebar is
an illustrative fixture using `withChatSections`, not a full Desktop screenshot.

The full Desktop integration was separately exercised locally: open the Bot's
Task, verify the real transcript and composer, return to the same Bot chat, and
reopen. The mode has no workspace tabs, breadcrumb, or half-width toggle.

The harness also sampled transform matrices during opening and closing and
verified that the task unmounts after closing.

![Bot chat with Task entry](bot-chat.png)

![Temporary full-width Task mode](task-mode.png)
