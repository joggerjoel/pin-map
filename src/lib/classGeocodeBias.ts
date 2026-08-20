// Nearly every classmate lives in the US, and city names collide across
// countries often enough (a plain "Chicago" or "Paris" search can resolve
// abroad) that biasing toward the US measurably improves match accuracy for
// this class's actual population, without hard-blocking a genuine
// non-US entry (the bias narrows ranking, it doesn't filter results out).
export const CLASS_GEOCODE_COUNTRY_BIAS = "us";
