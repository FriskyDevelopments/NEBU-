/**
 * Zoom DOM Selectors — integrations/zoom/selectors.js
 */

/* global window */

const ZoomSelectors = {
  WC_MEETING_ROOT: [
    '[data-testid="meeting-client"]',
    '[data-testid="meeting-web-client"]',
    '[aria-label*="Zoom Meeting"]',
    '#wc-container-left',
    '#zoom-meeting-root',
  ],
  WC_PREJOIN_ROOT: [
    '[data-testid*="prejoin"]',
    '[aria-label*="Join Meeting"]',
    '[data-testid*="preview"]',
  ],
  WC_ENDED_BANNER: [
    '[data-testid*="meeting-ended"]',
    '[aria-label*="meeting has ended"]',
    '[role="alert"][aria-live="assertive"]',
  ],
  WC_PARTICIPANTS_PANEL: [
    '#participants-panel',
    '[aria-label*="Participants"]',
    '[data-testid*="participants-panel"]',
    '[role="region"][aria-label*="Participants"]',
  ],
  WC_PARTICIPANT_ROW: [
    '[data-testid*="participants-item"]',
    '[data-testid*="participant-item"]',
    '[role="listitem"][aria-label]',
    '[role="listitem"]',
  ],
  WC_VIDEO_TILE: [
    '[data-testid*="video-tile"]',
    '[aria-label*="video tile"]',
    '[data-participant-id]',
    '[class*="video-tile"]',
  ],
  WC_CONTROL_BAR: [
    '[data-testid*="footer"]',
    '#wc-footer',
    '[role="toolbar"]',
    '[aria-label*="meeting controls"]',
  ],

  MEETING_ROOT: ['#wc-container-left', '[class*="meeting-client"]', '#zoom-meeting-root', '[data-testid="meeting-client"]'],

  VIDEO_TILE: ['[data-testid*="video-tile"]', '.video-avatar__avatar', '[class*="video-avatar"]', '[class*="video-tile"]'],
  VIDEO_TILE_NAME: ['[data-testid*="display-name"]', '[class*="display-name"]', '[class*="participant-name"]'],

  PARTICIPANTS_PANEL: ['#participants-panel', '[aria-label*="Participants"]', '[class*="participants-panel"]', '[data-testid*="participants-panel"]', '[role="region"][aria-label*="Participants"]'],
  PARTICIPANT_ROW: ['[data-testid*="participants-item"]', '[class*="participants-item"]', '[class*="participant-item"]', '[role="listitem"][aria-label]', '[role="listitem"]'],
  PARTICIPANT_ROW_NAME: ['[data-testid*="display-name"]', '[class*="participants-item__display-name"]', '[class*="participant__name"]'],

  HAND_RAISED_INDICATOR: ['[class*="hand-raise"]', '[aria-label*="Raise Hand"]', '[class*="raise-hand"]', '[aria-label*="Hand Raised"]'],
  CAMERA_OFF_INDICATOR: ['[class*="video-off"]', '[aria-label*="camera off"]', '[class*="avatar--camera-off"]', '[data-testid*="video-off"]'],

  WAITING_ROOM_PANEL: ['[aria-label*="Waiting Room"]', '[class*="waiting-room"]'],
  WAITING_ROOM_ADMIT_BTN: ['[aria-label*="Admit"]', 'button[class*="admit"]'],
  WAITING_ROOM_ADMIT_ALL_BTN: ['[aria-label*="Admit all"]', 'button[class*="admit-all"]'],

  CONTEXT_MENU: ['[class*="context-menu"]', '[role="menu"]', '[class*="menu-container"]'],
  CONTEXT_MENU_ITEM: ['[role="menuitem"]', '[class*="menu-item"]'],

  PIN_OPTION_TEXT: 'Pin',
  MULTIPIN_OPTION_TEXT: 'Multi-pin',
  UNPIN_OPTION_TEXT: 'Unpin',
  REMOVE_OPTION_TEXT: 'Remove',
  MUTE_OPTION_TEXT: 'Mute',

  CHAT_PANEL: ['#chat-panel', '[aria-label*="Chat"]', '[class*="chat-container"]'],
  CHAT_MESSAGE: ['[class*="chat-message__text"]', '[class*="chat-item"]'],
  CHAT_SENDER: ['[class*="chat-message__sender"]', '[class*="message-sender"]'],
  CHAT_OPEN_BTN: ['button[aria-label="Chat"]', 'button[aria-label="Open Chat"]'],
  CHAT_COMPOSER_PANEL: ['#chat-panel', '.chat-container'],
  CHAT_RECIPIENT: ['[data-testid="chat-recipient"]', '.chat-box__receiver'],
  CHAT_RECIPIENT_MENU: ['[data-testid="chat-recipient-menu"]', '.chat-box__receiver-list'],
  CHAT_RECIPIENT_OPTION: ['[role="option"]', '.chat-box__receiver-list-item'],
  CHAT_INPUT: ['textarea[aria-label="Type message here..."]', 'textarea.chat-box__chat-textarea'],

  TOOLBAR: ['#wc-footer', '[class*="footer-toolbar"]', '[data-testid*="footer"]', '[role="toolbar"]'],
  LEAVE_BTN: ['[aria-label*="Leave"]', 'button[class*="leave-meeting"]'],

  ROLE_HOST_BADGE: ['[aria-label*="Host"]', '[data-testid*="host-badge"]', '[class*="host-badge"]'],
  ROLE_COHOST_BADGE: ['[aria-label*="Co-host"]', '[aria-label*="Cohost"]', '[data-testid*="cohost-badge"]', '[class*="cohost"]'],
  HOST_ONLY_CONTROL: ['[aria-label*="End meeting for all"]', '[aria-label*="Manage Participants"]', '[data-testid*="security"]'],

  PARTICIPANT_MORE_BTN: ['[aria-label*="More"]', '[class*="more-button"]', 'button[class*="more"]'],
  MUTE_BTN: ['[aria-label*="Mute"]', 'button[class*="mute"]']
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZoomSelectors;
} else if (typeof window !== 'undefined') {
  window.ZoomSelectors = ZoomSelectors;
}
