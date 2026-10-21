# Effort picker save timing

Committed effort selections are sent immediately rather than through a timer canceled on unmount. The existing config synchronizer handles runtime acknowledgments and errors.

The previous screenshots and GIF were withdrawn because their component fixture did not show the real application interaction. Replacement visual evidence must use the running application and native model picker. A review finding about repeated keyboard steps while a save is pending remains under investigation.

Verification completed before that review: config-sync and effort tests, desktop build/typecheck, and focused lint. These checks do not establish that repeated keyboard input is fixed.
