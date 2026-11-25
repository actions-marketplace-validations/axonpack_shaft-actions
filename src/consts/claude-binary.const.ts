// Written by `bun run build` (src/meta.ts) from bun.lock. Don't edit.

/** The sha512 of each Claude Code binary package, by `name@version`. */
export const CLAUDE_BINARIES: Record<string, string> = {
  "@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.325": "sha512-0u8bTug2zH+zWE8CMiFrm/ldmH20uA9B/zhXpI7ATHFJnpPMdwTqE56CFM0m3LOwnNum0jpRn7XV1dn6Pf2pqA==",
  "@anthropic-ai/claude-agent-sdk-darwin-x64@0.3.325": "sha512-HD3YRFyM5H5QH2usS/WD6gobk3BEp2jq9dKyrkhAVdQIqFMlrcSrRhGA0i3R1IOLxtPAYkmDGepZ62k1kMOW9Q==",
  "@anthropic-ai/claude-agent-sdk-linux-arm64@0.3.325": "sha512-28oVrCEN6M6MJP8Od4SK/scal1QdLbn5Sci+qL8j55l6csHtPeUYF9zdjWLniFKph43pejfZf5te/Vf/bwehkw==",
  "@anthropic-ai/claude-agent-sdk-linux-arm64-musl@0.3.325": "sha512-72y6QNRZC4eMCxne/wNsuwNHsViSkgFKlYMCUVXxmiR9gpIMd3rf++oJMIsSuEAQqzqT7jwCrdtibv6R4bx5PA==",
  "@anthropic-ai/claude-agent-sdk-linux-x64@0.3.325": "sha512-wXEWbDmNYiorY5EKASYjvQct8zHShUPmAS9N/IAsgPA/cx2vsOFqPQw8jRQKeaW6AmFgx7k/Wf7THalNXbMEkQ==",
  "@anthropic-ai/claude-agent-sdk-linux-x64-musl@0.3.325": "sha512-BHewYUTd7mDLR5iHTVt6Q28gJKLC5C24b1H3NM0qGt9dxnjVUh1Lza52GzHY2Rb9hAPQymLSXWuVh1OFoFQatA==",
  "@anthropic-ai/claude-agent-sdk-win32-arm64@0.3.325": "sha512-NH3I2o105oKK8lfJ5RlzCp+YTZn3qncwQ1xSzQ4jqn7LUddThIidpFU7B+TKQxh1X9eayAp7EtrBQ36mXflQwQ==",
  "@anthropic-ai/claude-agent-sdk-win32-x64@0.3.325": "sha512-pjqVL++V/2oMJ6u1HdB608bcTUvzts1e8hX93Q8khasy2JB+R823bnvpQapcOurOWB3+v1X2JXIjXyWcGPJCQQ=="
};

/** The sha512 of each OpenCode binary package (`opencode-ai`'s), by `name@version`. */
export const OPENCODE_BINARIES: Record<string, string> = {
  "opencode-darwin-arm64@1.19.6": "sha512-GZjEsOTlr/e8fUF+lsFtTJGNIyHfUZcN9+iN6uXAbsH6t1PJABZrWE+5Lu2raX7g/EUXXCCB9NJ9L0AyMcWkKA==",
  "opencode-darwin-x64@1.19.6": "sha512-70AIcsjh9ywsh+cuRmSkMziKm/doJ0u9J/5BvU/ZCBpRYPWlKupGNWFRNua3xfjMqSjGuAmbQI2HjFpN+1OPyg==",
  "opencode-darwin-x64-baseline@1.19.6": "sha512-UkAI+p9HgDEnAlCOBLTAIqN4gW2+7yBEJxlNeioI1393n9RuMpJlHcOscvJG6yZn+wRRaFlSN2ct4sSLHGMhBQ==",
  "opencode-linux-arm64@1.19.6": "sha512-WnlZe6BgxKMeauniWrfiKNSq2tkz4FGwAdsBMeN5WPwsxURVu6Qm2eQuv1SvmJYGEmNKxyVfX3m1worvcP+c9Q==",
  "opencode-linux-arm64-musl@1.19.6": "sha512-mEKapEaz3mYXj27b2qXQT0da7whVAMr0hojM1EO7O4wo63XiJnTUVnMj6C3B6vh8yo5Y7ONFwpFq/264+4FCyQ==",
  "opencode-linux-x64@1.19.6": "sha512-SUQS023u46+2+wMUej1Cm8VSFpHUd2c6cO4m2r7suRaCgrdIjR1iXr7ebl31xb/gHzaYS65xnj1fxRqHpzhU1A==",
  "opencode-linux-x64-baseline@1.19.6": "sha512-514i1cj8ZGcgQKXg3EqAe2YVV5ID7EK3u6LuIqsSPhpVnWDwWjiJejYzhOWHbRMYpfbVbt6DHabs9BUbwHn7zg==",
  "opencode-linux-x64-baseline-musl@1.19.6": "sha512-qCdyZ7YMqwQ2KD7o9usUqA1B8B7pp4w/JozlN7NvVKHBIKE4t/hSYzVsovnsJK1zHkPY+yYa4qK5YQH333/+Yw==",
  "opencode-linux-x64-musl@1.19.6": "sha512-8hpOy4jogGewFDKDIyh4sLiDKsMKYmP0s6Y5xh2EgVgAkIjvj9sftxw2s9u6Ah4xKoUZ9nbu1Zbf4K03jL4qmg==",
  "opencode-windows-arm64@1.19.6": "sha512-vs0YKh09rQyDcr5bro3WL3MewGVT5EuPr990RtJFMk7o1fmUeGHAMlpMn42m50GsQpBEjRhG6JWbP5QEp7Mpvw==",
  "opencode-windows-x64@1.19.6": "sha512-qCh34hNhX4yaNmOfXZXjxbai5Y/HXgTgWKaTk/5TfDEAs+0QWr9OFiebJU/J3tvZnCLktjsEMAXJsoYwKI2mxg==",
  "opencode-windows-x64-baseline@1.19.6": "sha512-oUE9xI2iSucbdg4agPyQZeEpR3Ma06I2cchvWi6tUujSFAiLj4WjkYfMSxNRjIwOkVhDQ3Sh840bweMzRTExNg=="
};
