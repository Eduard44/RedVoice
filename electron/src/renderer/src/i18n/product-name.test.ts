import { describe, expect, it } from 'vitest';
import i18next from './index';
import { withProductName } from './product-name';

describe('product name in interface text', () => {
  it('shows RedVoice where a text names the app', () => {
    expect(withProductName('VoiceStudio is starting')).toBe('RedVoice is starting');
    expect(withProductName("VoiceStudio's data, VoiceStudio.")).toBe("RedVoice's data, RedVoice.");
    expect(withProductName('Reinicia VoiceStudio', 'settings.restart')).toBe('Reinicia RedVoice');
  });
  it("keeps the upstream name for upstream's own services, site and project", () => {
    for (const text of [
      'Get VoiceStudio Pro',
      'never contacts VoiceStudio Cloud.',
      'VoiceStudio.sh Open Source',
      'sent to the VoiceStudio team.',
      'a VoiceStudio sponsor',
      'Donate to VoiceStudio Project',
    ])
      expect(withProductName(text)).toBe(text);
    expect(withProductName('Cuenta de VoiceStudio', 'account.title')).toBe('Cuenta de VoiceStudio');
    expect(withProductName('VoiceStudio', ['mobile.app_name'])).toBe('VoiceStudio');
  });
  it('applies to every translated text the interface asks for', () => {
    expect(i18next.t('app.name')).toBe('RedVoice');
    expect(i18next.t('proPage.title')).toBe('VoiceStudio Pro');
  });
});
