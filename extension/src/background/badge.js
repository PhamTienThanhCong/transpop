/**
 * TransPop — toolbar badge: "OFF" on a neutral gray background while in-page translation is paused.
 */
// Badge text + tooltip follow the Display-language setting: t() here IS bgT().
import { bgT as t, ensureUiMessages } from './ui-messages.js';

const BADGE_BG = '#6B7280'; // neutral gray (white text ≥ 4.5:1)
const BADGE_FG = '#FFFFFF';

export async function updateBadge(settings) {
  const off = settings?.enabled === false;
  await ensureUiMessages(settings);
  try {
    await chrome.action.setBadgeText({ text: off ? t('bg_badge_off') : '' });
    if (off) {
      await chrome.action.setBadgeBackgroundColor({ color: BADGE_BG });
      if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: BADGE_FG });
    }
    await chrome.action.setTitle({ title: off ? t('bg_action_title_paused') : t('actionTitle') });
  } catch (err) {
    console.warn('[TransPop] badge update failed:', err?.message || err);
  }
}
