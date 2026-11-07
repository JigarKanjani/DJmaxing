# Seed sources for public/library.json

Every YouTube video ID in `public/library.json` was found and checked on November 7, 2026. No ID was typed from memory.

## Method

1. **Search.** For each song, the Firecrawl Alexandria YouTube provider (`youtube-com`, `videos/search_videos`) was queried with the song, the film or artist, and "official video". A result was accepted only when it came from the official label or artist channel (for example T-Series, Sony Music India, Zee Music Company, YRF, Saregama, Tips Official, Speed Records, Shemaroo, Rajshri, or the artist's own channel or VEVO). Lyric videos, audio-only uploads, Topic uploads, remixes, covers, fan uploads and re-uploads by unrelated channels were skipped.
2. **Details.** Every primary ID (the first ID for each song) was checked with `videos/video_details`. This gave the channel name, `length_seconds` (used as `durationSec`), playability status, publish date and available countries. All 84 primary IDs returned playability `OK`, and none were private.
3. **Embed check.** Every ID, both primary and fallback, was checked against YouTube oEmbed (`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=ID&format=json`) through the environment proxy. All 99 IDs in the library returned HTTP 200, so all of them are embeddable.
4. **Regions.** `available_countries` was compared against CA and IN where the provider reported it. See the notes below for the exceptions.
5. **Fallback IDs.** These are other official uploads from the same channel, such as a short edit, the full song, or an 8K re-release. They passed the search and oEmbed checks, but `video_details` was not run on them, so the Details column shows "not fetched".

`year` is set only where the publish date of the official video matches the song's release. It is null for re-uploads of older songs. `energy` and `fame` are estimates. `bpm`, `camelot`, `beatGrid`, `hook`, `vocals` and `loudnessLufs` are null until they are measured.

Artist credits come from the video titles and descriptions where those list them. Otherwise the commonly known main singers are used. Please spot check them in the curator.

## Sources

| Song id | Video id | Role | Channel | oEmbed | Details | CA / IN | Date checked |
|---|---|---|---|---|---|---|---|
| cant-stop-the-feeling-justin-timberlake | ru0K8uYEZWw | primary | justintimberlakeVEVO | 200 | OK | CA yes, IN yes | November 7, 2026 |
| hips-dont-lie-shakira | DUT5rEU6pqM | primary | shakiraVEVO | 200 | OK | CA yes, IN yes | November 7, 2026 |
| i-gotta-feeling-the-black-eyed-peas | uSD4vsh1zDA | primary | BlackEyedPeasVEVO | 200 | OK | CA yes, IN yes | November 7, 2026 |
| levitating-dua-lipa | TUVcZfQe-Kw | primary | Dua Lipa | 200 | OK | CA yes, IN yes | November 7, 2026 |
| party-rock-anthem-lmfao | KQ6zr6kCPj8 | primary | LMFAOVEVO | 200 | OK | CA yes, IN yes | November 7, 2026 |
| shape-of-you-ed-sheeran | JGwWNGJdvx8 | primary | Ed Sheeran | 200 | OK | CA yes, IN yes | November 7, 2026 |
| shut-up-and-dance-walk-the-moon | 6JCLY0Rlx6Q | primary | WalkTheMoonVEVO | 200 | OK | CA yes, IN yes | November 7, 2026 |
| timber-pitbull | hHUbLv4ThOo | primary | PitbullVEVO | 200 | OK | CA yes, IN yes | November 7, 2026 |
| uptown-funk-mark-ronson | OPf0YbXqDm0 | primary | MarkRonsonVEVO | 200 | OK | CA yes, IN yes | November 7, 2026 |
| yeah-usher | GxBSyx85Kp8 | primary | UsherVEVO | 200 | OK | CA yes, IN yes | November 7, 2026 |
| char-bangdi-vadi-gadi-kinjal-dave | xkR9KqFwPsA | primary | Studio Saraswati Official | 200 | OK | CA yes, IN yes | November 7, 2026 |
| sanedo-jignesh-barot | 2l-JHpsRVJE | primary | Saregama Gujarati | 200 | OK | CA yes, IN yes | November 7, 2026 |
| aaj-ki-raat-madhubanti-bagchi | roz9sXFkTuE | primary | Saregama Music | 200 | OK | CA yes, IN yes | November 7, 2026 |
| aaj-ki-raat-madhubanti-bagchi | hxMNYkLN7tI | fallback | Saregama Music | 200 | not fetched | not fetched | November 7, 2026 |
| aankh-marey-neha-kakkar | _KhQT-LGb-4 | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| abhi-toh-party-shuru-hui-hai-badshah | 8LZgzAZ2lpQ | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| badtameez-dil-benny-dayal | II2EO3Nw4m0 | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| balam-pichkari-vishal-dadlani | 0WtRNGubWGA | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| bom-diggy-diggy-zack-knight | yIIGQB6EMAM | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| chammak-challo-akon | ufHLYw9q7vQ | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| chammak-challo-akon | lxB-ki-qE64 | fallback | T-Series | 200 | not fetched | not fetched | November 7, 2026 |
| channa-mereya-arijit-singh | 284Ov7ysmfA | primary | Sony Music India | 200 | OK | CA yes, IN yes | November 7, 2026 |
| chogada-darshan-raval | yr7JFNsz5dU | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| choli-ke-peeche-alka-yagnik | 3OXiqmUhB70 | primary | Tips Official | 200 | OK | CA yes, IN yes | November 7, 2026 |
| desi-girl-sunidhi-chauhan | wDIrpvH8MzE | primary | Sony Music India | 200 | OK | CA yes, IN yes | November 7, 2026 |
| dholida-janhvi-shrimankar | uv9Dv6fzg9w | primary | Saregama Music | 200 | OK | CA yes, IN yes | November 7, 2026 |
| dholida-janhvi-shrimankar | Jh_VKJAEnUY | fallback | Saregama Music | 200 | not fetched | not fetched | November 7, 2026 |
| dhoom-machale-sunidhi-chauhan | 2uUmHTgT65I | primary | YRF | 200 | OK | CA yes, IN yes | November 7, 2026 |
| didi-tera-devar-deewana-lata-mangeshkar | ZqcDGvCM_w0 | primary | Rajshri | 200 | OK | CA yes, IN yes | November 7, 2026 |
| dil-diyan-gallan-atif-aslam | SAcpESN_Fk4 | primary | YRF | 200 | OK | CA yes, IN yes | November 7, 2026 |
| dilbar-neha-kakkar | TRa9IMvccjg | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| dum-maro-dum-asha-bhosle | GUn3P5QyLRY | primary | Saregama Music | 200 | OK | CA yes, IN yes | November 7, 2026 |
| gallan-goodiyaan-yashita-sharma | jCEdTq3j-0U | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| ghungroo-arijit-singh | qFkNATtc3mc | primary | YRF | 200 | OK | CA yes, IN yes | November 7, 2026 |
| i-am-a-disco-dancer-vijay-benedict | 7JdEZoffm-Q | primary | Shemaroo | 200 | OK | CA yes, IN yes | November 7, 2026 |
| its-the-time-to-disco-vasundhara-das | Y8ZN7QjQcP0 | primary | Sony Music India | 200 | OK | CA yes, IN yes | November 7, 2026 |
| its-the-time-to-disco-vasundhara-das | M03GOY5eINg | fallback | SonyMusicIndiaVEVO | 200 | not fetched | not fetched | November 7, 2026 |
| jhoome-jo-pathaan-arijit-singh | YxWlaYCA8MU | primary | YRF | 200 | OK | CA yes, IN yes | November 7, 2026 |
| kajra-re-alisha-chinai | 4dsFQFCvVGU | primary | YRF | 200 | OK | CA yes, IN yes | November 7, 2026 |
| kajra-re-alisha-chinai | plUxChXs3w8 | fallback | YRF | 200 | not fetched | not fetched | November 7, 2026 |
| kala-chashma-badshah | k4yXQkG2s1E | primary | Zee Music Company | 200 | OK | CA yes, IN yes | November 7, 2026 |
| kar-gayi-chull-badshah | NTHz9ephYTw | primary | Sony Music India | 200 | OK | CA yes, IN yes | November 7, 2026 |
| kar-gayi-chull-badshah | -sWXx1mbgtU | fallback | SonyMusicIndiaVEVO | 200 | not fetched | not fetched | November 7, 2026 |
| kesariya-arijit-singh | BddP6PYo2gs | primary | Sony Music India | 200 | OK | CA yes, IN yes | November 7, 2026 |
| koi-kahe-kehta-rahe-shankar-mahadevan | ctJI7pCbxAo | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| kun-faya-kun-a-r-rahman | T94PHkuydcw | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| london-thumakda-labh-janjua | udra3Mfw2oo | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| lungi-dance-yo-yo-honey-singh | 69CEiHfS_mc | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| lungi-dance-yo-yo-honey-singh | fbwCgt1hMD4 | fallback | T-Series | 200 | not fetched | not fetched | November 7, 2026 |
| malhari-vishal-dadlani | l_MyUGq7pgs | primary | Sony Music India | 200 | OK | CA yes, IN yes | November 7, 2026 |
| mauja-hi-mauja-mika-singh | PaDaoNnOQaM | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| mehbooba-mehbooba-r-d-burman | ByAbV-MKDgs | primary | Shemaroo Filmi Gaane | 200 | OK | CA yes, IN yes | November 7, 2026 |
| mehndi-laga-ke-rakhna-lata-mangeshkar | -bNwqXvMuB8 | primary | YRF | 200 | OK | CA yes, IN yes | November 7, 2026 |
| nachde-ne-saare-jasleen-royal | HgIW7P4dsXU | primary | Zee Music Company | 200 | OK | CA yes, IN yes | November 7, 2026 |
| nagada-sang-dhol-shreya-ghoshal | vK5E_aeBGYA | primary | Sony Music India | 200 | OK | CA yes, IN yes | November 7, 2026 |
| nagada-sang-dhol-shreya-ghoshal | 3X7x4Ye-tqo | fallback | Sony Music India | 200 | not fetched | not fetched | November 7, 2026 |
| nashe-si-chadh-gayi-arijit-singh | HoCwa6gnmM0 | primary | YRF | 200 | OK | CA yes, IN yes | November 7, 2026 |
| om-shanti-om-kishore-kumar | BF5tVDJCAUM | primary | Saregama Music | 200 | OK | CA yes, IN yes | November 7, 2026 |
| raataan-lambiyan-jubin-nautiyal | gvyUuxdRdR4 | primary | Sony Music India | 200 | OK | CA yes, IN yes | November 7, 2026 |
| saajanji-ghar-aaye-alka-yagnik | 8XtXLVylOoU | primary | Sony Music India | 200 | OK | CA yes, IN yes | November 7, 2026 |
| sheila-ki-jawani-sunidhi-chauhan | ZTmF2v59CtI | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| swag-se-swagat-vishal-dadlani | 7TRFf7uUfhQ | primary | YRF | 200 | OK | CA yes, IN yes | November 7, 2026 |
| swag-se-swagat-vishal-dadlani | xmU0s2QtaEY | fallback | YRF | 200 | not fetched | not fetched | November 7, 2026 |
| tamma-tamma-loge-bappi-lahiri | Xs5k7d6kzh8 | primary | T-Series Bollywood Classics | 200 | OK | CA yes, IN yes | November 7, 2026 |
| tareefan-badshah | 3SWc5G8Gx7E | primary | Zee Music Company | 200 | OK | CA yes, IN yes | November 7, 2026 |
| tujhe-dekha-to-lata-mangeshkar | cNV5hLSa9H8 | primary | YRF | 200 | OK | CA yes, IN yes | November 7, 2026 |
| tum-hi-ho-arijit-singh | IJq0yyWug1k | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| what-jhumka-arijit-singh | P1fIdFRnfqw | primary | Saregama Music | 200 | OK | CA yes, IN yes | November 7, 2026 |
| what-jhumka-arijit-singh | 87JIOAX3njM | fallback | Saregama Music | 200 | not fetched | not fetched | November 7, 2026 |
| amplifier-imran-khan | uuCFRaFWjwY | primary | imrankhanworld | 200 | OK | CA yes, IN yes | November 7, 2026 |
| angreji-beat-gippy-grewal | YEf_hnXBbyI | primary | Speed Records | 200 | OK | CA yes, IN yes | November 7, 2026 |
| angreji-beat-gippy-grewal | Bj3a53PYt5A | fallback | Planet Recordz | 200 | not fetched | not fetched | November 7, 2026 |
| blue-eyes-yo-yo-honey-singh | NbyHNASFi6U | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| bolo-ta-ra-ra-daler-mehndi | BjlkPLaHRf4 | primary | Daler Mehndi | 200 | OK | CA yes, IN yes | November 7, 2026 |
| bolo-ta-ra-ra-daler-mehndi | h6Ze5Hqa1wA | fallback | Daler Mehndi | 200 | not fetched | not fetched | November 7, 2026 |
| brown-munde-ap-dhillon | VNs_cCtdbPc | primary | APDHILLON | 200 | OK | not reported | November 7, 2026 |
| brown-rang-yo-yo-honey-singh | ZbKaRZFnqn8 | primary | Planet Recordz | 200 | OK | CA yes, IN no | November 7, 2026 |
| daru-badnaam-kamal-kahlon | bzW9fmwcmG4 | primary | VIP Records | 200 | OK | CA yes, IN yes | November 7, 2026 |
| do-you-know-diljit-dosanjh | P-DhwN87JDY | primary | FAMOUS STUDIOS | 200 | OK | CA yes, IN yes | November 7, 2026 |
| excuses-ap-dhillon | vX2cDW8LUWk | primary | Intense | 200 | OK | CA yes, IN yes | November 7, 2026 |
| goat-diljit-dosanjh | cl0a3i2wFcc | primary | Diljit Dosanjh | 200 | OK | CA yes, IN yes | November 7, 2026 |
| gallan-kardi-jazzy-b | eHjwuNhJXw4 | primary | Tips Official | 200 | OK | CA yes, IN yes | November 7, 2026 |
| gur-nalon-ishq-mitha-bally-sagoo | _rGz16v3CUM | primary | Universal Music India | 200 | OK | CA yes, IN yes | November 7, 2026 |
| gur-nalon-ishq-mitha-bally-sagoo | OAKag1aFDy8 | fallback | Fresh Dope Records - Bally Sagoo | 200 | not fetched | not fetched | November 7, 2026 |
| high-rated-gabru-guru-randhawa | hjWf8A0YNSE | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| ishq-tera-tadpave-oh-ho-ho-ho-sukhbir | -99Z8E1pOrs | primary | Sukhbir | 200 | OK | CA yes, IN yes | November 7, 2026 |
| lahore-guru-randhawa | dZ0fwJojhrs | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| lamberghini-the-doorbeen | 5X7WWVTrBvM | primary | Speed Records | 200 | OK | CA yes, IN yes | November 7, 2026 |
| lover-diljit-dosanjh | mH_LFkWxpI0 | primary | Diljit Dosanjh | 200 | OK | CA yes, IN yes | November 7, 2026 |
| morni-banke-guru-randhawa | 1EadhOBcfI0 | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| morni-banke-guru-randhawa | MhgURCPNoD0 | fallback | T-Series | 200 | not fetched | not fetched | November 7, 2026 |
| mundian-to-bach-ke-panjabi-mc | x9WO2ieJMYk | primary | Altra Moda Music | 200 | OK | CA yes, IN yes | November 7, 2026 |
| proper-patola-diljit-dosanjh | GVhmynWOPoM | primary | SonyMusicIndiaVEVO | 200 | OK | CA yes, IN yes | November 7, 2026 |
| so-high-sidhu-moose-wala | GgmFC8y8q3k | primary | Humble Music | 200 | OK | CA yes, IN yes | November 7, 2026 |
| softly-karan-aujla | cWMxCE2HTag | primary | Karan Aujla | 200 | OK | CA yes, IN yes | November 7, 2026 |
| suit-guru-randhawa | uQ763VvqiEM | primary | T-Series | 200 | OK | CA yes, IN yes | November 7, 2026 |
| tauba-tauba-karan-aujla | LK7-_dgAVQE | primary | Saregama Music | 200 | OK | CA yes, IN yes | November 7, 2026 |
| tunak-tunak-tun-daler-mehndi | eZ2PtEx9-ls | primary | Daler Mehndi | 200 | OK | CA yes, IN yes | November 7, 2026 |
| tunak-tunak-tun-daler-mehndi | 92ydUdqWE1g | fallback | Daler Mehndi Music | 200 | not fetched | not fetched | November 7, 2026 |

## Notes and exclusions

- **brown-rang-yo-yo-honey-singh:** The Moviebox Record Label upload (iX4qQlm-0NY) is not available in CA or IN, so it was dropped. The Planet Recordz upload (ZbKaRZFnqn8) is used instead. It is available in CA, MX and US only, so it will not play in India.
- **brown-munde-ap-dhillon:** The provider returned no country list or publish date for VNs_cCtdbPc. Playability was OK and oEmbed returned 200.
- **angreji-beat-gippy-grewal:** The Speed Records upload is available in 157 countries, CA and IN included.
- **mundian-to-bach-ke-panjabi-mc:** This is the Altra Moda Music upload from 2023, not a 2003 original.
- **gur-nalon-ishq-mitha-bally-sagoo:** The primary is the Universal Music India upload from 2024. The fallback is the Bally Sagoo (Fresh Dope Records) channel upload.
- **sanedo-jignesh-barot:** This is the 2025 Saregama Gujarati version by Jignesh Barot, not the older folk recordings.
- Songs searched but left out because no official video upload could be confirmed in the results:
  - Chaiyya Chaiyya (Dil Se): only remasters, fan uploads and an unconfirmed artist upload were found.
  - Ek Do Teen (Tezaab) and Dafliwale Dafli Baja (Sargam): the top uploads were from Ultra Bollywood. I could not confirm that channel as the rights holder, and the Saregama result for Dafliwale was a remix.
  - Jumma Chumma De De (Hum): Saregama had only audio and lyrics uploads.
  - Mungda (Inkaar), Ek Pal Ka Jeena (Kaho Naa Pyaar Hai) and Yeh Mera Dil (Don): no official video upload was found.
  - Piya Tu Ab To Aaja (Caravan): the only Saregama result could not be confirmed as a video.
  - Apna Bana Le (Bhediya): Zee Music Company had only the full audio in the results.
  - 5 Taara (Diljit Dosanjh): Speed Records had only an audio lyrical upload in the results.
- No data was taken from naux.party or any other third-party DJ app.
- Capability calls used: 94 `search_videos` and 85 `video_details`, 179 in total.
