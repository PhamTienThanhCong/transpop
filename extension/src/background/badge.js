/**
 * TransPop — toolbar badge: "OFF" on a neutral gray background while in-page translation is paused.
 */
import { t } from '../shared/i18n.js';

const BADGE_BG = '#6B7280'; // neutral gray (white text ≥ 4.5:1)
const BADGE_FG = '#FFFFFF';

export async function updateBadge(settings) {
  const off = settings?.enabled === false;
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
