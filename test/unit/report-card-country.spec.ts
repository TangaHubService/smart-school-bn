import { officialCountryName, schoolCountryName } from '../../src/modules/locations/eac-countries.constant';

describe('country printed on report cards', () => {
  it.each([
    ['Rwanda', 'Republic of Rwanda'],
    ['kenya', 'Republic of Kenya'],
    ['Tanzania', 'United Republic of Tanzania'],
    ['Ghana', 'Ghana'],
    [null, ''],
  ])('%s prints as "%s"', (country, expected) => {
    expect(officialCountryName(country)).toBe(expected);
  });

  it('prefers the registered country code over the country text', () => {
    expect(schoolCountryName({ country: 'Rwanda', adminCountryCode: 'ug' })).toBe('Uganda');
    expect(schoolCountryName({ country: 'Burundi', adminCountryCode: null })).toBe('Burundi');
  });
});
