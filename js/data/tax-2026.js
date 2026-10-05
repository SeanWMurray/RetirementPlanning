/*
 * Tax & benefit parameters — 2026 tax year.
 *
 * To add a new year: copy this file to tax-YYYY.js, update the numbers, add a
 * <script> tag in index.html, and it appears in the "Tax table year" picker.
 * The engine indexes all dollar thresholds forward from `year` using the plan's
 * inflation rate (unless a jurisdiction is flagged `indexed: false`).
 *
 * `verify` marks values that are estimates (e.g. prior-year amount indexed by
 * the published indexation factor) rather than confirmed published figures.
 * They are surfaced in the Tax tab so users know what to double-check.
 *
 * Brackets: [{ upTo: threshold or null for top bracket, rate }]
 * Credits are non-refundable and multiplied by `creditRate` (lowest bracket rate).
 */
(function (RP) {
  'use strict';
  RP.taxData = RP.taxData || {};

  RP.taxData['2026'] = {
    year: 2026,
    label: '2026',
    sourceNote: 'CRA and provincial 2026 indexed amounts. Items marked "estimate" were indexed from 2025 and should be verified.',

    federal: {
      brackets: [
        { upTo: 58523, rate: 0.14 },
        { upTo: 117045, rate: 0.205 },
        { upTo: 181440, rate: 0.26 },
        { upTo: 258482, rate: 0.29 },
        { upTo: null, rate: 0.33 }
      ],
      creditRate: 0.14,
      // BPA is reduced from max to min between the 4th bracket threshold and the top bracket.
      bpa: { max: 16452, min: 14829, phaseStart: 181440, phaseEnd: 258482 },
      age: { amount: 9208, threshold: 46432, reductionRate: 0.15, verify: true },
      pension: { amount: 2000 },
      canadaEmployment: { amount: 1501, verify: true },
      quebecAbatement: 0.165
    },

    payroll: {
      cpp: { ympe: 74600, yampe: 85000, exemption: 3500, baseRate: 0.0495, firstEnhancedRate: 0.01, cpp2Rate: 0.04 },
      // QPP: base 5.4% + first additional 1% = 6.4%; QPP2 4%.
      qpp: { ympe: 74600, yampe: 85000, exemption: 3500, baseRate: 0.054, firstEnhancedRate: 0.01, cpp2Rate: 0.04, verify: true },
      ei: { maxInsurable: 68900, rate: 0.0163, rateQC: 0.013, verify: false },
      qpip: { maxInsurable: 103000, rate: 0.00494, verify: true },
      stopAge: 70
    },

    oas: {
      // Annual maximum at age 65–74 (sum of quarterly rates, approx.).
      maxAnnual65: 8900,
      age75Boost: 0.10,
      clawbackThreshold: 95323,
      clawbackRate: 0.15,
      deferralPerMonth: 0.006,
      maxDeferralMonths: 60,
      verify: true
    },

    cpp: {
      // Pension adjustment for taking CPP early / late (relative to 65).
      earlyPerMonth: 0.006,
      latePerMonth: 0.007,
      maxAt65_2026: 18091, // approx. maximum annual retirement pension at 65 for reference only
      verify: true
    },

    provinces: {
      AB: {
        name: 'Alberta',
        brackets: [
          { upTo: 61200, rate: 0.08 }, { upTo: 154259, rate: 0.10 }, { upTo: 185111, rate: 0.12 },
          { upTo: 246813, rate: 0.13 }, { upTo: 370220, rate: 0.14 }, { upTo: null, rate: 0.15 }
        ],
        bpa: { max: 22769 },
        age: { amount: 6472, threshold: 48179, reductionRate: 0.15, verify: true },
        pension: { amount: 1753, verify: true }
      },
      BC: {
        name: 'British Columbia',
        brackets: [
          { upTo: 50363, rate: 0.056 }, { upTo: 100728, rate: 0.077 }, { upTo: 115648, rate: 0.105 },
          { upTo: 140430, rate: 0.1229 }, { upTo: 190405, rate: 0.147 }, { upTo: 265545, rate: 0.168 },
          { upTo: null, rate: 0.205 }
        ],
        bpa: { max: 13216 },
        age: { amount: 5927, threshold: 44119, reductionRate: 0.15, verify: true },
        pension: { amount: 1000 },
        verify: true
      },
      MB: {
        name: 'Manitoba',
        indexed: false,
        brackets: [{ upTo: 47000, rate: 0.108 }, { upTo: 100000, rate: 0.1275 }, { upTo: null, rate: 0.174 }],
        // BPA phased out between $200k and $400k of net income (from 2025).
        bpa: { max: 15780, min: 0, phaseStart: 200000, phaseEnd: 400000 },
        age: { amount: 3728, threshold: 27749, reductionRate: 0.15 },
        pension: { amount: 1000 }
      },
      NB: {
        name: 'New Brunswick',
        brackets: [{ upTo: 52333, rate: 0.094 }, { upTo: 104666, rate: 0.14 }, { upTo: 193861, rate: 0.16 }, { upTo: null, rate: 0.195 }],
        bpa: { max: 13664 },
        age: { amount: 6159, threshold: 45860, reductionRate: 0.15, verify: true },
        pension: { amount: 1000 }
      },
      NL: {
        name: 'Newfoundland and Labrador',
        brackets: [
          { upTo: 44678, rate: 0.087 }, { upTo: 89354, rate: 0.145 }, { upTo: 159528, rate: 0.158 },
          { upTo: 223340, rate: 0.178 }, { upTo: 285319, rate: 0.198 }, { upTo: 570638, rate: 0.208 },
          { upTo: 1141275, rate: 0.213 }, { upTo: null, rate: 0.218 }
        ],
        bpa: { max: 11188 },
        age: { amount: 7141, threshold: 38797, reductionRate: 0.15, verify: true },
        pension: { amount: 1000 }
      },
      NS: {
        name: 'Nova Scotia',
        brackets: [
          { upTo: 30995, rate: 0.0879 }, { upTo: 61991, rate: 0.1495 }, { upTo: 97417, rate: 0.1667 },
          { upTo: 157124, rate: 0.175 }, { upTo: null, rate: 0.21 }
        ],
        bpa: { max: 11932 },
        age: { amount: 5227, threshold: 31321, reductionRate: 0.15, verify: true },
        pension: { amount: 1173 }
      },
      NT: {
        name: 'Northwest Territories',
        brackets: [{ upTo: 53003, rate: 0.059 }, { upTo: 106009, rate: 0.086 }, { upTo: 172346, rate: 0.122 }, { upTo: null, rate: 0.1405 }],
        bpa: { max: 18198 },
        age: { amount: 8901, threshold: 46432, reductionRate: 0.15, verify: true },
        pension: { amount: 1000 }
      },
      NU: {
        name: 'Nunavut',
        brackets: [{ upTo: 55801, rate: 0.04 }, { upTo: 111602, rate: 0.07 }, { upTo: 181439, rate: 0.09 }, { upTo: null, rate: 0.115 }],
        bpa: { max: 19659 },
        age: { amount: 12255, threshold: 46432, reductionRate: 0.15, verify: true },
        pension: { amount: 2000 }
      },
      ON: {
        name: 'Ontario',
        brackets: [
          { upTo: 53891, rate: 0.0505 }, { upTo: 107785, rate: 0.0915 }, { upTo: 150000, rate: 0.1116 },
          { upTo: 220000, rate: 0.1216 }, { upTo: null, rate: 0.1316 }
        ],
        bpa: { max: 12989 },
        age: { amount: 6342, threshold: 47210, reductionRate: 0.15, verify: true },
        pension: { amount: 1796, verify: true },
        // Surtax: 20% of basic Ontario tax over t1, plus 36% over t2.
        surtax: [{ threshold: 5818, rate: 0.20 }, { threshold: 7446, rate: 0.36 }],
        // Ontario Health Premium (not indexed). Piecewise: [from, to, base, rate on excess, cap]
        healthPremium: [
          { from: 20000, base: 0, rate: 0.06, cap: 300 },
          { from: 36000, base: 300, rate: 0.06, cap: 450 },
          { from: 48000, base: 450, rate: 0.25, cap: 600 },
          { from: 72000, base: 600, rate: 0.25, cap: 750 },
          { from: 200000, base: 750, rate: 0.25, cap: 900 }
        ],
        rules: ['ontarioSurtax', 'ontarioHealthPremium']
      },
      PE: {
        name: 'Prince Edward Island',
        brackets: [
          { upTo: 33928, rate: 0.095 }, { upTo: 65820, rate: 0.1347 }, { upTo: 106890, rate: 0.166 },
          { upTo: 142520, rate: 0.1762 }, { upTo: null, rate: 0.19 }
        ],
        bpa: { max: 15000 },
        age: { amount: 6510, threshold: 36600, reductionRate: 0.15, verify: true },
        pension: { amount: 1000 }
      },
      QC: {
        name: 'Quebec',
        brackets: [{ upTo: 54345, rate: 0.14 }, { upTo: 108680, rate: 0.19 }, { upTo: 132245, rate: 0.24 }, { upTo: null, rate: 0.2575 }],
        bpa: { max: 18952 },
        // Quebec combines age/pension amounts with a family-income reduction; simplified here.
        age: { amount: 4053, threshold: 42800, reductionRate: 0.1875, verify: true },
        pension: { amount: 3374, verify: true },
        usesQPP: true,
        federalAbatement: true
      },
      SK: {
        name: 'Saskatchewan',
        brackets: [{ upTo: 54532, rate: 0.105 }, { upTo: 155805, rate: 0.125 }, { upTo: null, rate: 0.145 }],
        bpa: { max: 20381 },
        age: { amount: 5728, threshold: 42601, reductionRate: 0.15, verify: true },
        pension: { amount: 1000 }
      },
      YT: {
        name: 'Yukon',
        brackets: [
          { upTo: 58523, rate: 0.064 }, { upTo: 117045, rate: 0.09 }, { upTo: 181440, rate: 0.109 },
          { upTo: 500000, rate: 0.128 }, { upTo: null, rate: 0.15 }
        ],
        // Yukon BPA mirrors the federal amount, including the high-income phase-out.
        bpa: { max: 16452, min: 14829, phaseStart: 181440, phaseEnd: 258482 },
        age: { amount: 9208, threshold: 46432, reductionRate: 0.15, verify: true },
        pension: { amount: 2000 }
      }
    },

    // RRIF minimum withdrawal factors by age at January 1 (age 71 and over).
    // Under 71 the factor is 1 / (90 - age).
    rrifFactors: {
      71: 0.0528, 72: 0.0540, 73: 0.0553, 74: 0.0567, 75: 0.0582, 76: 0.0598, 77: 0.0617,
      78: 0.0636, 79: 0.0658, 80: 0.0682, 81: 0.0708, 82: 0.0738, 83: 0.0771, 84: 0.0808,
      85: 0.0851, 86: 0.0899, 87: 0.0955, 88: 0.1021, 89: 0.1099, 90: 0.1192, 91: 0.1306,
      92: 0.1449, 93: 0.1634, 94: 0.1879, 95: 0.2000
    },

    capitalGainsInclusion: 0.5,

    // Contribution limits (for reference / default caps).
    limits: { rrspMax: 33810, rrspPct: 0.18, tfsaAnnual: 7000 }
  };

  RP.taxData.latest = '2026';
})(globalThis.RP);
