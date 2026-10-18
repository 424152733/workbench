export const channelNames = ['知乎', '小红书', '公众号'];

export function platformsForTopic(topic) {
  const selected = Array.isArray(topic?.platforms)
    ? channelNames.filter((channel) => topic.platforms.includes(channel))
    : channelNames;
  return selected.length ? selected : channelNames;
}
