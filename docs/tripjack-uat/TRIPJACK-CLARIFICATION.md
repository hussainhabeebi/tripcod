# Draft clarification request to TripJack — not sent

Subject: Flight API v2.0.2 UAT certification passenger-limit clarification

Hi TripJack API Team,

We are preparing Tripcod Flight API UAT certification. The document lists error 1006 as a maximum of nine passengers, but these eight certification rows exceed nine when adults, children and infants are counted together:

| Case | Journey / sector | Adults | Children | Infants | Total | Flight |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| ONEWAY-06 | DXB–BKK | 5 | 3 | 2 | 10 | DIRECT |
| ONEWAY-07 | DXB–BKK | 5 | 3 | 2 | 10 | CONNECTING |
| ONEWAY-08 | BOM–MAA | 5 | 4 | 3 | 12 | DIRECT |
| ROUNDTRIP-06 | DXB–BKK | 5 | 3 | 2 | 10 | DIRECT |
| ROUNDTRIP-07 | DXB–BKK | 5 | 3 | 2 | 10 | CONNECTING |
| ROUNDTRIP-08 | BOM–MAA | 5 | 4 | 3 | 12 | DIRECT |
| ROUNDTRIP-10 | DEL–BOM | 5 | 3 | 2 | 10 | CONNECTING |
| MULTICITY-02 | DOMESTIC — sectors to agree | 5 | 4 | 1 | 10 | DIRECT |

Please confirm:

1. Does the nine-passenger limit include lap infants, or apply only to adults plus children?
2. Should all eight rows be executed as written for our staging account? If not, please provide approved replacement counts or exemptions.
3. Which exact certification matrix/version should we submit?

We have preserved the original counts and marked these cases blocked pending clarification. We will not bypass passenger validation or execute them without your guidance.

Regards,
Tripcod Integration Team
