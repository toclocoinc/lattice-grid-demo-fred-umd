/**
 * The series this dashboard shows, and what each one is.
 *
 * Every series here is published by a US federal agency and is in the public
 * domain, so the values can be saved into this repository and served from it.
 * Series that FRED redistributes under a licence -- Case-Shiller, the NAR's
 * existing-home sales, Moody's spreads, the Michigan sentiment survey, index
 * levels, mortgage rates -- are deliberately absent, and the snapshot tool
 * refuses to write any series whose FRED notes carry a copyright line.
 *
 * `unitGroup` is what the chart's two value axes are chosen from: series that
 * share a group can share a scale. It is coarser than `units` on purpose --
 * "Billions of chained 2017 dollars" and "Billions of dollars" plot together
 * perfectly well, and a reader comparing them wants one axis, not two.
 *
 * `frequency` is the frequency FRED publishes at. Daily and weekly series are
 * reduced to one reading a month in the snapshot (the last reading of the
 * month, stamped on the first of it) so every series lines up on one monthly
 * date column; `frequencyNote` says so on the row.
 */

/** The five series whose vintages -- the numbers as first published -- are saved. */
export const HEADLINE = ['A191RL1Q225SBEA', 'GDPC1', 'PAYEMS', 'UNRATE', 'CPIAUCSL'];

/** The recession indicator. Drawn as shading; never a row in the catalogue. */
export const RECESSION_SERIES = 'USREC';

/** The earliest observation kept in the snapshot. */
export const OBSERVATION_START = '1970-01-01';

/** The earliest observation kept in the vintage record. */
export const VINTAGE_START = '2015-01-01';

/**
 * The vintage dates the "as first published" view offers.
 *
 * Four a year from 2019, which lands each one shortly after a quarterly GDP
 * release and after that month's payroll and CPI releases, with 2020 thickened
 * to monthly through the spring so the pandemic quarters can be watched being
 * revised. The snapshot tool asks ALFRED for the series exactly as it stood on
 * each of these days; a date on which nothing had changed simply produces a
 * column identical to the one before it, and the tool reports how many of them
 * differ.
 */
export const VINTAGE_DATES = [
  '2019-02-01', '2019-05-01', '2019-08-01', '2019-11-01',
  '2020-02-01', '2020-04-01', '2020-05-01', '2020-06-01',
  '2020-07-01', '2020-08-01', '2020-09-01', '2020-11-01',
  '2021-02-01', '2021-05-01', '2021-08-01', '2021-11-01',
  '2022-02-01', '2022-05-01', '2022-08-01', '2022-11-01',
  '2023-02-01', '2023-05-01', '2023-08-01', '2023-11-01',
  '2024-02-01', '2024-05-01', '2024-08-01', '2024-11-01',
  '2025-02-01', '2025-05-01', '2025-08-01', '2025-11-01',
  '2026-02-01', '2026-05-01', '2026-08-01',
];

/**
 * The catalogue.
 *
 * @type {{id: string, title: string, category: string, units: string,
 *   unitGroup: string, frequency: string, seasonal: string, source: string}[]}
 */
export const SERIES = [
  /* ---- Output and income (Bureau of Economic Analysis) ---- */
  { id: 'A191RL1Q225SBEA', title: 'Real GDP, growth rate', category: 'Output and income', units: 'Percent change, annual rate', unitGroup: 'Percent', frequency: 'Quarterly', seasonal: 'Seasonally adjusted annual rate', source: 'Bureau of Economic Analysis' },
  { id: 'GDPC1', title: 'Real gross domestic product', category: 'Output and income', units: 'Billions of chained 2017 dollars', unitGroup: 'Billions of dollars', frequency: 'Quarterly', seasonal: 'Seasonally adjusted annual rate', source: 'Bureau of Economic Analysis' },
  { id: 'GDP', title: 'Gross domestic product', category: 'Output and income', units: 'Billions of dollars', unitGroup: 'Billions of dollars', frequency: 'Quarterly', seasonal: 'Seasonally adjusted annual rate', source: 'Bureau of Economic Analysis' },
  { id: 'PCE', title: 'Personal consumption expenditures', category: 'Output and income', units: 'Billions of dollars', unitGroup: 'Billions of dollars', frequency: 'Monthly', seasonal: 'Seasonally adjusted annual rate', source: 'Bureau of Economic Analysis' },
  { id: 'GPDI', title: 'Gross private domestic investment', category: 'Output and income', units: 'Billions of dollars', unitGroup: 'Billions of dollars', frequency: 'Quarterly', seasonal: 'Seasonally adjusted annual rate', source: 'Bureau of Economic Analysis' },
  { id: 'DSPIC96', title: 'Real disposable personal income', category: 'Output and income', units: 'Billions of chained 2017 dollars', unitGroup: 'Billions of dollars', frequency: 'Monthly', seasonal: 'Seasonally adjusted annual rate', source: 'Bureau of Economic Analysis' },
  { id: 'PSAVERT', title: 'Personal saving rate', category: 'Output and income', units: 'Percent', unitGroup: 'Percent', frequency: 'Monthly', seasonal: 'Seasonally adjusted annual rate', source: 'Bureau of Economic Analysis' },
  { id: 'GDPDEF', title: 'GDP implicit price deflator', category: 'Output and income', units: 'Index 2017 = 100', unitGroup: 'Index', frequency: 'Quarterly', seasonal: 'Seasonally adjusted', source: 'Bureau of Economic Analysis' },

  /* ---- Prices ---- */
  { id: 'CPIAUCSL', title: 'Consumer price index, all items', category: 'Prices', units: 'Index 1982-84 = 100', unitGroup: 'Index', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'Bureau of Labor Statistics' },
  { id: 'CPILFESL', title: 'Core CPI, all items less food and energy', category: 'Prices', units: 'Index 1982-84 = 100', unitGroup: 'Index', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'Bureau of Labor Statistics' },
  { id: 'PCEPI', title: 'PCE price index', category: 'Prices', units: 'Index 2017 = 100', unitGroup: 'Index', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'Bureau of Economic Analysis' },
  { id: 'PCEPILFE', title: 'Core PCE price index', category: 'Prices', units: 'Index 2017 = 100', unitGroup: 'Index', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'Bureau of Economic Analysis' },
  { id: 'PPIACO', title: 'Producer price index, all commodities', category: 'Prices', units: 'Index 1982 = 100', unitGroup: 'Index', frequency: 'Monthly', seasonal: 'Not seasonally adjusted', source: 'Bureau of Labor Statistics' },

  /* ---- Labour ---- */
  { id: 'PAYEMS', title: 'All employees, total nonfarm', category: 'Labour', units: 'Thousands of persons', unitGroup: 'Thousands', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'Bureau of Labor Statistics' },
  { id: 'UNRATE', title: 'Unemployment rate', category: 'Labour', units: 'Percent', unitGroup: 'Percent', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'Bureau of Labor Statistics' },
  { id: 'U6RATE', title: 'Unemployment rate, U-6 (broadest measure)', category: 'Labour', units: 'Percent', unitGroup: 'Percent', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'Bureau of Labor Statistics' },
  { id: 'CIVPART', title: 'Labour force participation rate', category: 'Labour', units: 'Percent', unitGroup: 'Percent', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'Bureau of Labor Statistics' },
  { id: 'ICSA', title: 'Initial unemployment claims', category: 'Labour', units: 'Number', unitGroup: 'Number', frequency: 'Weekly', seasonal: 'Seasonally adjusted', source: 'US Employment and Training Administration' },
  { id: 'JTSJOL', title: 'Job openings, total nonfarm', category: 'Labour', units: 'Thousands', unitGroup: 'Thousands', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'Bureau of Labor Statistics' },
  { id: 'CES0500000003', title: 'Average hourly earnings, private', category: 'Labour', units: 'Dollars per hour', unitGroup: 'Dollars', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'Bureau of Labor Statistics' },

  /* ---- Interest rates (Board of Governors, H.15) ---- */
  { id: 'FEDFUNDS', title: 'Federal funds effective rate', category: 'Interest rates', units: 'Percent', unitGroup: 'Percent', frequency: 'Monthly', seasonal: 'Not seasonally adjusted', source: 'Board of Governors of the Federal Reserve System' },
  { id: 'DGS2', title: 'Treasury yield, 2 year', category: 'Interest rates', units: 'Percent', unitGroup: 'Percent', frequency: 'Daily', seasonal: 'Not seasonally adjusted', source: 'Board of Governors of the Federal Reserve System' },
  { id: 'DGS5', title: 'Treasury yield, 5 year', category: 'Interest rates', units: 'Percent', unitGroup: 'Percent', frequency: 'Daily', seasonal: 'Not seasonally adjusted', source: 'Board of Governors of the Federal Reserve System' },
  { id: 'DGS10', title: 'Treasury yield, 10 year', category: 'Interest rates', units: 'Percent', unitGroup: 'Percent', frequency: 'Daily', seasonal: 'Not seasonally adjusted', source: 'Board of Governors of the Federal Reserve System' },
  { id: 'DGS30', title: 'Treasury yield, 30 year', category: 'Interest rates', units: 'Percent', unitGroup: 'Percent', frequency: 'Daily', seasonal: 'Not seasonally adjusted', source: 'Board of Governors of the Federal Reserve System' },
  { id: 'T10Y2Y', title: 'Yield spread, 10 year less 2 year', category: 'Interest rates', units: 'Percent', unitGroup: 'Percent', frequency: 'Daily', seasonal: 'Not seasonally adjusted', source: 'Board of Governors of the Federal Reserve System' },
  { id: 'T10Y3M', title: 'Yield spread, 10 year less 3 month', category: 'Interest rates', units: 'Percent', unitGroup: 'Percent', frequency: 'Daily', seasonal: 'Not seasonally adjusted', source: 'Board of Governors of the Federal Reserve System' },

  /* ---- Money and credit (Board of Governors) ---- */
  { id: 'M2SL', title: 'M2 money stock', category: 'Money and credit', units: 'Billions of dollars', unitGroup: 'Billions of dollars', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'Board of Governors of the Federal Reserve System' },
  { id: 'WALCL', title: 'Federal Reserve total assets', category: 'Money and credit', units: 'Millions of dollars', unitGroup: 'Millions of dollars', frequency: 'Weekly', seasonal: 'Not seasonally adjusted', source: 'Board of Governors of the Federal Reserve System' },
  { id: 'TOTALSL', title: 'Consumer credit outstanding', category: 'Money and credit', units: 'Billions of dollars', unitGroup: 'Billions of dollars', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'Board of Governors of the Federal Reserve System' },
  { id: 'BUSLOANS', title: 'Commercial and industrial loans', category: 'Money and credit', units: 'Billions of dollars', unitGroup: 'Billions of dollars', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'Board of Governors of the Federal Reserve System' },

  /* ---- Housing (Census Bureau and HUD) ---- */
  { id: 'HOUST', title: 'Housing starts, new privately owned', category: 'Housing', units: 'Thousands of units, annual rate', unitGroup: 'Thousands', frequency: 'Monthly', seasonal: 'Seasonally adjusted annual rate', source: 'US Census Bureau and US Department of Housing and Urban Development' },
  { id: 'PERMIT', title: 'Building permits, new privately owned', category: 'Housing', units: 'Thousands of units, annual rate', unitGroup: 'Thousands', frequency: 'Monthly', seasonal: 'Seasonally adjusted annual rate', source: 'US Census Bureau and US Department of Housing and Urban Development' },
  { id: 'HSN1F', title: 'New one-family houses sold', category: 'Housing', units: 'Thousands of units, annual rate', unitGroup: 'Thousands', frequency: 'Monthly', seasonal: 'Seasonally adjusted annual rate', source: 'US Census Bureau and US Department of Housing and Urban Development' },
  { id: 'MSPUS', title: 'Median sales price of houses sold', category: 'Housing', units: 'Dollars', unitGroup: 'Dollars', frequency: 'Quarterly', seasonal: 'Not seasonally adjusted', source: 'US Census Bureau and US Department of Housing and Urban Development' },

  /* ---- Production and trade ---- */
  { id: 'INDPRO', title: 'Industrial production index', category: 'Production and trade', units: 'Index 2017 = 100', unitGroup: 'Index', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'Board of Governors of the Federal Reserve System' },
  { id: 'TCU', title: 'Capacity utilisation, total industry', category: 'Production and trade', units: 'Percent of capacity', unitGroup: 'Percent', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'Board of Governors of the Federal Reserve System' },
  { id: 'RSAFS', title: 'Retail and food services sales', category: 'Production and trade', units: 'Millions of dollars', unitGroup: 'Millions of dollars', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'US Census Bureau' },
  { id: 'DGORDER', title: 'Manufacturers new orders, durable goods', category: 'Production and trade', units: 'Millions of dollars', unitGroup: 'Millions of dollars', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'US Census Bureau' },
  { id: 'BOPGSTB', title: 'Trade balance, goods and services', category: 'Production and trade', units: 'Millions of dollars', unitGroup: 'Millions of dollars', frequency: 'Monthly', seasonal: 'Seasonally adjusted', source: 'US Census Bureau and Bureau of Economic Analysis' },

  /* ---- Government ---- */
  { id: 'GFDEBTN', title: 'Federal debt, total public debt', category: 'Government', units: 'Millions of dollars', unitGroup: 'Millions of dollars', frequency: 'Quarterly', seasonal: 'Not seasonally adjusted', source: 'US Department of the Treasury' },
  { id: 'GFDEGDQ188S', title: 'Federal debt as a share of GDP', category: 'Government', units: 'Percent of GDP', unitGroup: 'Percent', frequency: 'Quarterly', seasonal: 'Seasonally adjusted', source: 'US Office of Management and Budget and Bureau of Economic Analysis' },
  { id: 'FYFSD', title: 'Federal surplus or deficit', category: 'Government', units: 'Millions of dollars', unitGroup: 'Millions of dollars', frequency: 'Annual', seasonal: 'Not seasonally adjusted', source: 'US Office of Management and Budget' },

  /* ---- Energy (Energy Information Administration) ---- */
  { id: 'DCOILWTICO', title: 'Crude oil price, West Texas Intermediate', category: 'Energy', units: 'Dollars per barrel', unitGroup: 'Dollars', frequency: 'Daily', seasonal: 'Not seasonally adjusted', source: 'US Energy Information Administration' },
  { id: 'GASREGW', title: 'Retail gasoline price, regular', category: 'Energy', units: 'Dollars per gallon', unitGroup: 'Dollars', frequency: 'Weekly', seasonal: 'Not seasonally adjusted', source: 'US Energy Information Administration' },

  /* ---- The dollar (Board of Governors, H.10) ---- */
  { id: 'DEXUSEU', title: 'US dollars to one euro', category: 'The dollar', units: 'US dollars to one euro', unitGroup: 'Dollars', frequency: 'Daily', seasonal: 'Not seasonally adjusted', source: 'Board of Governors of the Federal Reserve System' },
  { id: 'DTWEXBGS', title: 'Broad dollar index, goods and services', category: 'The dollar', units: 'Index Jan 2006 = 100', unitGroup: 'Index', frequency: 'Daily', seasonal: 'Not seasonally adjusted', source: 'Board of Governors of the Federal Reserve System' },
];

/** The recession indicator's own entry, fetched but never shown as a row. */
export const RECESSION = {
  id: RECESSION_SERIES,
  title: 'NBER recession indicator',
  category: 'Recessions',
  units: '0 or 1',
  unitGroup: 'Number',
  frequency: 'Monthly',
  seasonal: 'Not seasonally adjusted',
  source: 'Federal Reserve Bank of St. Louis, from NBER business cycle dates',
};

/** The series the page opens with selected. */
export const DEFAULT_SELECTION = ['A191RL1Q225SBEA', 'UNRATE', 'CPIAUCSL', 'FEDFUNDS', 'DGS10'];
