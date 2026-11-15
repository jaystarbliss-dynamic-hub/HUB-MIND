import { CALENDAR_SCOPES, GMAIL_SCOPES, requestGoogleAccessToken, getCachedCalendarToken } from './googleAuthToken';

export const initGoogleApi = async () => {
  return true;
};

export const getGoogleToken = async (): Promise<string> => {
  const requiredScopes = [...CALENDAR_SCOPES, ...GMAIL_SCOPES];
  const cached = getCachedCalendarToken(requiredScopes);
  if (cached) return cached;
  return requestGoogleAccessToken(requiredScopes);
};

export const getCalendarEvents = async (timeMin: string, timeMax: string) => {
  const token = await getGoogleToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) throw new Error("Failed to fetch calendar");
  return res.json();
};

export const sendEmail = async (to: string, subject: string, body: string) => {
  const token = await getGoogleToken();
  const rawMessage = `To: ${to}\r\nSubject: ${subject}\r\n\r\n${body}`;
  const encodedMessage = btoa(unescape(encodeURIComponent(rawMessage))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: encodedMessage })
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const apiMessage = errorData?.error?.message || errorData?.error_description || errorData?.error || '';
    if (res.status === 403) {
      const detail = apiMessage ? 'Google denied Gmail send permission: ' + apiMessage : 'Google denied Gmail send permission.';
      throw new Error(detail + ' Reconnect the Google account and approve Gmail send access.');
    }
    throw new Error(apiMessage || ('Gmail send failed with HTTP ' + res.status + '.'));
  }
  return res.json();
};

export const createCalendarEvent = async (summary: string, description: string, start: string, end: string) => {
  const token = await getGoogleToken();
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      summary,
      description,
      start: { dateTime: start },
      end: { dateTime: end }
    })
  });
  if (!res.ok) throw new Error("Failed to create calendar event");
  return res.json();
};
