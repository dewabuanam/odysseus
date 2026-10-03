// Line drawings from the Odyssey for empty, quiet places in the app: the welcome screen, a
// clean working tree, an empty history. They sit behind or beside the content, never in the
// way of it: faint, unclickable, and drawn in graphite on paper or in chalk on the board
// (see .art in styles.css). The same drawings run down the Odysseus website.

export type ArtName =
  | 'ship' | 'cyclops' | 'siren' | 'calypso' | 'horse' | 'owl'
  | 'trident' | 'helmet' | 'amphora' | 'scylla' | 'aeolus' | 'bow'
  | 'lotus' | 'circe' | 'cattle' | 'argos' | 'loom'

// label names each scene; the drawings themselves are decorative and hidden from assistive tech.
const ART: Record<ArtName, { viewBox: string; label: string; body: React.ReactNode }> = {
  ship: {
    viewBox: '0 0 360 260',
    label: 'Setting sail from Troy',
    body: (
      <>
        {/* sail and rigging */}
        <path d="M175 162 V36" />
        <path d="M106 50 Q175 36 244 50" />
        <path d="M112 53 Q106 100 120 142 Q175 152 230 142 Q244 100 238 53" />
        <path className="thin" d="M140 50 Q136 100 144 146 M175 46 V150 M210 50 Q214 100 206 146" />
        <path className="thin" d="M175 36 L36 124 M175 36 L318 104" />
        <path className="thin" d="M118 96 Q175 108 234 96" />
        {/* hull with curled prow and stern */}
        <path d="M40 168 L316 160" />
        <path d="M30 172 Q60 208 180 208 Q292 208 322 164" />
        <path d="M30 172 Q16 150 24 128 Q30 116 40 122 Q44 130 36 132" />
        <path d="M322 164 Q342 138 332 110 Q326 96 314 104 Q312 114 322 114" />
        <path d="M30 180 L8 184 L32 192" />
        <path d="M44 176 Q52 170 62 176 Q52 182 44 176 Z" />
        <circle className="fill" cx="53" cy="176" r="2.4" />
        {/* shields along the gunwale */}
        <circle cx="90" cy="164" r="7" /><circle cx="120" cy="163" r="7" /><circle cx="150" cy="162" r="7" />
        <circle cx="200" cy="162" r="7" /><circle cx="230" cy="161" r="7" /><circle cx="260" cy="161" r="7" />
        {/* oars */}
        <path className="thin" d="M80 190 L56 226 M104 194 L80 230 M128 196 L104 232 M152 197 L128 233 M176 198 L152 234 M200 197 L176 233 M224 196 L200 232 M248 194 L224 230 M272 190 L248 226" />
        {/* waves */}
        <path d="M0 230 q15 -12 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0" />
        <path className="thin" d="M20 248 q15 -10 30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0 t30 0" />
      </>
    )
  },
  cyclops: {
    viewBox: '0 0 320 340',
    label: 'Polyphemus the Cyclops',
    body: (
      <>
        {/* boulder held overhead */}
        <path d="M206 40 Q228 8 266 20 Q294 40 284 72 Q258 92 228 80 Q200 66 206 40 Z" />
        <path className="thin" d="M228 34 L244 52 L238 70 M262 30 L256 48 L274 60" />
        <path d="M246 84 Q262 150 236 214 M220 80 Q232 140 212 204" />
        {/* head */}
        <path d="M90 128 Q84 56 150 50 Q216 56 210 128 Q210 172 180 192 Q150 206 120 192 Q90 172 90 128 Z" />
        <path d="M90 120 Q74 116 76 134 Q80 148 93 142" />
        <path d="M210 120 Q226 116 224 134 Q220 148 207 142" />
        {/* the single eye and its heavy brow */}
        <path d="M110 96 Q150 70 190 96" className="bold" />
        <path d="M118 112 Q150 88 182 112 Q150 134 118 112 Z" />
        <circle cx="150" cy="111" r="11" />
        <circle className="fill" cx="150" cy="111" r="4.5" />
        <path d="M150 122 Q143 144 138 148 Q150 155 162 148" />
        <path d="M124 168 Q150 182 176 168" />
        <path className="thin" d="M134 172 L136 178 M146 175 L146 181 M158 175 L157 181 M168 172 L166 178" />
        {/* wild hair and curled beard */}
        <path className="thin" d="M96 92 Q98 62 124 56 M104 70 Q120 44 150 46 M150 46 Q184 44 198 70 M178 54 Q204 60 206 92" />
        <path d="M110 184 Q116 226 150 234 Q184 226 190 184" />
        <path className="thin" d="M124 204 q6 8 0 16 M140 212 q6 8 0 16 M158 212 q6 8 0 16 M174 204 q6 8 0 16" />
        {/* shoulders */}
        <path d="M60 340 Q52 252 122 222" />
        <path d="M260 340 Q268 260 206 214" />
        <path className="thin" d="M92 300 Q110 270 140 262 M230 300 Q214 272 186 262" />
      </>
    )
  },
  siren: {
    viewBox: '0 0 300 300',
    label: "The sirens' song",
    body: (
      <>
        {/* rock and sea */}
        <path d="M26 282 Q46 222 110 216 Q170 206 212 226 Q262 240 278 282" />
        <path className="thin" d="M70 250 L96 236 L120 246 M180 240 L204 252 L226 246" />
        <path className="thin" d="M0 290 q12 -8 24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t24 0 t24 0" />
        {/* talons */}
        <path className="thin" d="M130 212 l-6 8 M130 212 l0 9 M130 212 l6 8 M160 212 l-6 8 M160 212 l0 9 M160 212 l6 8" />
        {/* bird body, folded wing and tail */}
        <path d="M110 200 Q100 160 125 132 Q150 118 175 136 Q196 160 186 196 Q170 212 140 212 Q120 210 110 200 Z" />
        <path d="M132 142 Q176 142 194 186" />
        <path className="thin" d="M140 160 q8 6 16 0 q8 6 16 0 M146 176 q8 6 16 0 q8 6 16 0" />
        <path d="M186 190 Q230 210 262 200 M184 182 Q228 190 256 176 M181 174 Q220 170 246 156" />
        {/* raised wing */}
        <path d="M156 126 Q164 62 226 40 Q214 78 236 88 Q206 98 210 118 Q190 118 174 132" />
        <path className="thin" d="M170 110 Q186 80 216 56 M176 120 Q198 98 226 88" />
        {/* head, hair and song */}
        <ellipse cx="140" cy="100" rx="19" ry="21" />
        <path d="M133 120 L134 130 M147 120 L146 130" />
        <path d="M122 92 Q110 112 116 138 M124 84 Q100 96 104 128 M121 88 Q136 70 159 86" />
        <path className="thin" d="M132 98 q4 3 8 0 M144 98 q4 3 8 0" />
        <circle cx="143" cy="110" r="2.6" />
        {/* lyre */}
        <path d="M94 154 Q78 124 90 100 M116 154 Q128 124 118 100 M88 108 L120 108 M94 154 L116 154" />
        <path className="thin" d="M99 108 V152 M105 108 V152 M111 108 V152" />
        <path className="thin" d="M60 70 q8 -10 16 0 M44 96 q6 -8 12 0" />
      </>
    )
  },
  calypso: {
    viewBox: '0 0 360 270',
    label: "Calypso's island",
    body: (
      <>
        {/* sun and birds */}
        <circle cx="300" cy="46" r="15" />
        <path className="thin" d="M300 20 V12 M300 80 V72 M274 46 H266 M334 46 H326 M282 28 L276 22 M318 28 L324 22 M282 64 L276 70 M318 64 L324 70" />
        <path className="thin" d="M200 52 q6 -6 12 0 q6 -6 12 0 M232 72 q5 -5 10 0 q5 -5 10 0" />
        {/* island and cave */}
        <path d="M14 212 Q80 150 170 148 Q270 148 346 212" />
        <path d="M196 208 Q200 168 232 164 Q264 168 268 208" />
        <path className="thin" d="M210 206 L216 180 M222 206 L226 174 M236 206 L238 172 M250 206 L250 178" />
        {/* palms */}
        <path d="M86 208 Q92 152 118 102" />
        <path className="thin" d="M92 180 l8 2 M96 160 l8 2 M102 140 l8 2 M110 120 l8 2" />
        <path d="M118 102 Q88 86 62 104 M118 102 Q100 70 76 66 M118 102 Q128 70 156 68 M118 102 Q150 92 172 114 M118 102 Q114 80 122 58" />
        <circle cx="114" cy="108" r="3.5" /><circle cx="122" cy="108" r="3.5" />
        <path d="M306 206 Q304 170 290 136" />
        <path d="M290 136 Q268 126 252 138 M290 136 Q282 112 264 108 M290 136 Q304 114 324 116 M290 136 Q314 140 326 158" />
        {/* the nymph at her loom */}
        <circle cx="160" cy="132" r="8" />
        <path d="M152 128 Q150 120 160 120 Q172 120 168 130 M166 124 q8 0 6 8" />
        <path d="M155 141 Q144 170 138 198 L184 198 Q176 170 165 141" />
        <path className="thin" d="M148 172 Q160 176 172 172 M156 150 L144 170" />
        <path d="M120 198 V150 M136 150 H120 M120 198 H136" />
        <path className="thin" d="M124 152 V196 M128 152 V196 M132 152 V196" />
        {/* the raft that finally carries Odysseus away */}
        <path d="M14 238 q14 -10 28 0 t28 0 t28 0 t28 0 t28 0 t28 0 t28 0 t28 0 t28 0 t28 0 t28 0 t28 0" />
        <path d="M280 228 L344 228 L338 236 L286 236 Z" />
        <path d="M312 228 V188 M312 190 Q332 200 330 222 L312 222" />
        <path className="thin" d="M30 256 q14 -8 28 0 t28 0 t28 0 t28 0 t28 0 t28 0 t28 0 t28 0 t28 0 t28 0" />
      </>
    )
  },
  horse: {
    viewBox: '0 0 300 300',
    label: 'The wooden horse',
    body: (
      <>
        {/* platform and wheels */}
        <path d="M46 248 H254 V262 H46 Z" />
        <circle cx="80" cy="272" r="13" /><circle cx="220" cy="272" r="13" />
        <path className="thin" d="M80 259 V285 M67 272 H93 M220 259 V285 M207 272 H233" />
        {/* legs */}
        <path d="M86 248 L92 182 M106 248 L108 184 M196 248 L196 184 M218 248 L212 182" />
        {/* plank body with the hidden hatch */}
        <path d="M80 186 Q68 140 110 130 L198 130 Q236 136 226 186 Q150 196 80 186 Z" />
        <path className="thin" d="M80 150 L228 150 M78 168 L228 168" />
        <path className="thin" d="M110 132 L106 188 M140 130 L138 192 M170 130 L170 192 M200 130 L202 190" />
        <path d="M136 154 H166 V172 H136 Z" />
        {/* neck, head and mane */}
        <path d="M196 132 L214 70 M226 136 L246 80" />
        <path d="M214 70 Q218 44 244 40 L274 58 Q280 70 268 76 L246 80" />
        <path d="M232 44 L236 26 L244 42" />
        <circle className="fill" cx="250" cy="54" r="3" />
        <path className="thin" d="M206 96 l-10 -4 M210 84 l-10 -4 M216 70 l-10 -6 M222 58 l-8 -8" />
        <path d="M78 150 Q52 162 58 204" />
      </>
    )
  },
  owl: {
    viewBox: '0 0 240 290',
    label: "Athena's owl",
    body: (
      <>
        {/* olive branch */}
        <path d="M10 236 Q120 222 232 240" />
        <path className="thin" d="M40 232 q-10 -14 6 -22 q4 14 -6 22 M70 228 q-4 16 14 18 q-2 -14 -14 -18 M180 232 q8 -14 24 -8 q-10 12 -24 8 M206 236 q2 16 18 16 q-4 -14 -18 -16" />
        <ellipse cx="52" cy="242" rx="5" ry="3.6" /><ellipse cx="196" cy="246" rx="5" ry="3.6" />
        {/* body */}
        <path d="M70 120 Q60 210 120 232 Q180 210 170 120" />
        <path d="M70 120 Q72 60 120 58 Q168 60 170 120" />
        <path d="M78 64 L70 38 L98 56 M162 64 L170 38 L142 56" />
        {/* the famous eyes */}
        <circle cx="96" cy="104" r="21" /><circle cx="144" cy="104" r="21" />
        <circle cx="96" cy="104" r="9" /><circle cx="144" cy="104" r="9" />
        <circle className="fill" cx="96" cy="104" r="4" /><circle className="fill" cx="144" cy="104" r="4" />
        <path d="M114 122 L120 138 L126 122 Z" />
        {/* chest feathers and wings */}
        <path className="thin" d="M100 160 q6 6 12 0 q6 6 12 0 q6 6 12 0 M94 178 q6 6 12 0 q6 6 12 0 q6 6 12 0 q6 6 12 0 M100 196 q6 6 12 0 q6 6 12 0 q6 6 12 0" />
        <path d="M70 130 Q50 180 84 222 M170 130 Q190 180 156 222" />
        <path className="thin" d="M104 232 l-4 10 M112 234 l0 10 M128 234 l0 10 M136 232 l4 10" />
      </>
    )
  },
  trident: {
    viewBox: '0 0 160 330',
    label: "Poseidon's wrath",
    body: (
      <>
        <path d="M80 290 V96" />
        <path d="M80 96 V18 M72 32 L80 18 L88 32" />
        <path d="M80 100 Q46 100 42 66 V26 M34 40 L42 26 L50 40" />
        <path d="M80 100 Q114 100 118 66 V26 M110 40 L118 26 L126 40" />
        <path d="M66 104 H94 M68 112 H92" />
        <path className="thin" d="M76 130 L84 138 M76 150 L84 158 M76 170 L84 178 M76 190 L84 198" />
        <path d="M0 292 q14 -12 28 0 t28 0 t28 0 t28 0 t28 0 t28 0" />
        <path className="thin" d="M10 310 q12 -9 24 0 t24 0 t24 0 t24 0 t24 0 t24 0" />
        <path className="thin" d="M30 272 q6 -10 14 -4 M114 270 q8 -10 16 -2" />
      </>
    )
  },
  helmet: {
    viewBox: '0 0 240 250',
    label: 'A Corinthian helmet',
    body: (
      <>
        {/* horsehair crest */}
        <path d="M84 52 Q90 4 150 6 Q208 10 222 64 Q202 60 192 70 Q180 30 142 28 Q112 30 108 48" />
        <path className="thin" d="M100 40 Q110 18 140 14 M124 26 Q150 14 180 22 M160 30 Q190 30 206 52 M150 18 L156 30 M176 22 L174 36 M196 34 L188 46" />
        {/* bowl, cheek pieces, eye openings and nose guard */}
        <path d="M60 104 Q58 46 120 44 Q182 46 180 104 L178 180 Q176 214 150 226 L136 226 L134 176" />
        <path d="M60 104 L62 180 Q64 214 90 226 L104 226 L106 176" />
        <path d="M106 176 Q120 190 134 176" />
        <path className="thin" d="M64 112 Q120 96 176 112" />
        <path d="M76 130 Q92 114 112 124 L112 142 Q94 150 76 140 Z" />
        <path d="M164 130 Q148 114 128 124 L128 142 Q146 150 164 140 Z" />
        <path d="M112 124 L115 180 L125 180 L128 124" />
        <path className="thin" d="M70 190 Q80 206 96 214 M170 190 Q160 206 144 214" />
      </>
    )
  },
  amphora: {
    viewBox: '0 0 200 300',
    label: 'An amphora',
    body: (
      <>
        <path d="M70 18 H130 M74 18 Q76 28 80 34 H120 Q124 28 126 18" />
        <path d="M82 34 Q84 58 86 70 M118 34 Q116 58 114 70" />
        <path d="M86 70 Q30 100 40 170 Q50 238 92 262 L108 262 Q150 238 160 170 Q170 100 114 70" />
        <path d="M92 262 L84 284 H116 L108 262" />
        <path d="M84 40 Q48 40 52 92 M116 40 Q152 40 148 92" />
        <path className="thin" d="M48 120 Q100 134 152 120 M46 132 Q100 146 154 132" />
        <path className="thin" d="M52 162 q8 -10 16 0 t16 0 t16 0 t16 0 t16 0 t16 0" />
        <path className="thin" d="M46 196 Q100 212 154 196 M50 208 Q100 222 150 208" />
        <path className="thin" d="M62 120 V132 M78 124 V136 M94 126 V138 M110 126 V138 M126 124 V136 M142 120 V132" />
      </>
    )
  },
  scylla: {
    viewBox: '0 0 340 290',
    label: 'Scylla',
    body: (
      <>
        {/* cliff with her cave */}
        <path d="M8 282 L28 186 L58 156 L88 166 L108 124 L138 134 L150 282" />
        <path d="M118 236 Q124 204 144 204 Q150 220 148 250" />
        <path className="thin" d="M40 220 L60 206 M70 250 L92 236 M96 196 L114 186" />
        {/* three serpent necks with snapping heads */}
        <path d="M144 214 Q200 204 210 144 Q216 104 250 92" />
        <path d="M250 92 Q270 76 294 86 L302 92 L282 98 Q270 106 252 104" />
        <path className="thin" d="M282 98 l4 6 l4 -6 l4 5" />
        <circle className="fill" cx="270" cy="88" r="2.6" />
        <path d="M146 232 Q230 242 262 192 Q282 162 306 160" />
        <path d="M306 160 Q322 148 338 156 L330 166 Q320 172 308 170" />
        <circle className="fill" cx="322" cy="157" r="2.2" />
        <path d="M142 196 Q172 154 162 104 Q158 64 190 42" />
        <path d="M190 42 Q206 26 228 32 L236 38 L220 44 Q208 52 192 50" />
        <circle className="fill" cx="210" cy="36" r="2.4" />
        <path className="thin" d="M186 160 l8 4 M200 130 l8 2 M172 120 l8 0 M230 220 l6 6 M250 206 l6 6" />
        {/* the passing ship */}
        <path d="M206 266 L266 266 L260 274 L212 274 Z" />
        <path d="M236 266 V232 M236 234 Q254 244 252 262 L236 262" />
        <path d="M150 282 q14 -10 28 0 t28 0 t28 0 t28 0 t28 0 t28 0 t28 0" />
      </>
    )
  },
  aeolus: {
    viewBox: '0 0 270 230',
    label: 'The bag of winds',
    body: (
      <>
        {/* cloud with the wind god's face */}
        <path d="M40 120 Q30 80 70 76 Q80 40 120 50 Q150 24 180 54 Q218 50 218 90 Q238 112 208 130 Q190 150 150 140 Q110 156 80 140 Q44 150 40 120 Z" />
        <path className="thin" d="M98 86 q8 -6 16 0 M134 86 q8 -6 16 0" />
        <circle cx="106" cy="92" r="2" /><circle cx="142" cy="92" r="2" />
        <path className="thin" d="M92 104 a12 10 0 0 0 20 6 M156 104 a12 10 0 0 1 -20 6" />
        <path d="M124 96 q-4 10 2 12" />
        <circle cx="126" cy="122" r="5" />
        {/* the winds he lets loose */}
        <path d="M134 120 Q190 110 262 118 M132 128 Q196 140 258 134 M134 114 Q180 96 246 96" />
        <path className="thin" d="M246 96 q12 2 8 12 q-6 6 -12 0 M258 134 q12 -2 8 -12" />
        {/* the ox-hide bag his crew should never have opened */}
        <path d="M30 216 Q8 184 40 170 Q76 176 64 216 Z" />
        <path d="M34 170 L48 168 M38 166 Q30 156 40 150 M46 166 Q54 156 46 150" />
        <path className="thin" d="M30 196 Q44 202 58 196" />
      </>
    )
  },
  bow: {
    viewBox: '0 0 370 220',
    label: 'The bow and the twelve axes',
    body: (
      <>
        {/* the great bow, drawn */}
        <path d="M64 30 Q16 112 64 194" />
        <path d="M64 30 Q58 22 66 18 M64 194 Q58 202 66 206" />
        <path className="thin" d="M64 30 L82 112 L64 194" />
        <path className="thin" d="M40 100 L46 124" />
        {/* the arrow through every ring */}
        <path d="M82 112 H360" />
        <path d="M360 112 l-12 -6 M360 112 l-12 6" />
        <path className="thin" d="M82 112 l-8 -8 M82 112 l-8 8 M90 112 l-8 -8 M90 112 l-8 8" />
        {/* twelve axe heads in a row */}
        <path className="thin" d="M118 204 V122 M124 104 Q133 112 124 122 M137 204 V122 M143 104 Q152 112 143 122 M156 204 V122 M162 104 Q171 112 162 122 M175 204 V122 M181 104 Q190 112 181 122 M194 204 V122 M200 104 Q209 112 200 122 M213 204 V122 M219 104 Q228 112 219 122 M232 204 V122 M238 104 Q247 112 238 122 M251 204 V122 M257 104 Q266 112 257 122 M270 204 V122 M276 104 Q285 112 276 122 M289 204 V122 M295 104 Q304 112 295 122 M308 204 V122 M314 104 Q323 112 314 122 M327 204 V122 M333 104 Q342 112 333 122" />
        <circle cx="118" cy="112" r="6" /><circle cx="137" cy="112" r="6" /><circle cx="156" cy="112" r="6" /><circle cx="175" cy="112" r="6" /><circle cx="194" cy="112" r="6" /><circle cx="213" cy="112" r="6" /><circle cx="232" cy="112" r="6" /><circle cx="251" cy="112" r="6" /><circle cx="270" cy="112" r="6" /><circle cx="289" cy="112" r="6" /><circle cx="308" cy="112" r="6" /><circle cx="327" cy="112" r="6" />
        <path d="M100 204 H356" />
        <path className="thin" d="M110 214 H346" />
      </>
    )
  },
  lotus: {
    viewBox: '0 0 260 240',
    label: 'The lotus-eaters',
    body: (
      <>
        <path d="M90 110 Q82 86 90 70 Q98 86 90 110 M90 110 Q64 96 68 76 Q82 88 90 110 M90 110 Q116 96 112 76 Q98 88 90 110 M90 110 Q54 108 50 94 Q72 96 90 110 M90 110 Q126 108 130 94 Q108 96 90 110" />
        <path d="M170 90 Q161 62 170 44 Q179 62 170 90 M170 90 Q140 74 145 51 Q161 65 170 90 M170 90 Q200 74 195 51 Q179 65 170 90 M170 90 Q129 88 124 72 Q149 74 170 90 M170 90 Q211 88 216 72 Q191 74 170 90" />
        <path d="M214 140 Q208 121 214 108 Q220 121 214 140 M214 140 Q193 129 196 113 Q208 122 214 140 M214 140 Q235 129 232 113 Q220 122 214 140 M214 140 Q185 138 182 127 Q200 129 214 140 M214 140 Q243 138 246 127 Q228 129 214 140" />
        <path d="M90 110 Q96 160 110 206 M170 90 Q160 150 150 206 M214 140 Q206 176 200 206" />
        <path d="M24 206 Q70 196 110 210 Q60 222 24 206 Z M140 212 Q190 198 236 212 Q190 226 140 212 Z" />
        <path className="thin" d="M110 210 L122 204 M140 212 L150 206" />
        <path className="thin" d="M0 226 q13 -8 26 0 t26 0 t26 0 t26 0 t26 0 t26 0 t26 0 t26 0 t26 0 t26 0" />
        <path className="thin" d="M40 150 q-6 -16 6 -24 q6 12 -6 24 M234 108 q10 -12 22 -6 q-10 10 -22 6" />
      </>
    )
  },
  circe: {
    viewBox: '0 0 300 240',
    label: "Circe's cup",
    body: (
      <>
        {/* the potion cup and its fumes */}
        <path d="M10 70 H100 Q90 94 55 96 Q20 94 10 70 Z" />
        <path d="M55 96 V118 M38 122 Q55 112 72 122 Z" />
        <path className="thin" d="M10 72 q-10 -2 -8 -10 M100 72 q10 -2 8 -10" />
        <path className="thin" d="M48 64 q-6 -10 2 -18 q8 -8 0 -18 M64 64 q6 -10 -2 -18 q-8 -8 0 -18" />
        {/* her wand */}
        <path d="M242 52 L290 14" />
        <path className="thin" d="M282 6 l4 10 M276 14 l12 0 M250 30 l3 7 M246 36 l9 -1" />
        {/* a crewman turned swine */}
        <path d="M70 160 Q70 120 120 118 Q180 114 200 140 Q210 160 196 182 Q160 196 110 192 Q72 188 70 160 Z" />
        <path d="M196 140 Q220 128 236 142 Q244 150 240 162 Q230 172 206 172" />
        <path d="M236 142 Q250 146 248 160 Q242 164 236 162" />
        <circle className="fill" cx="243" cy="152" r="1.6" /><circle className="fill" cx="220" cy="144" r="2.4" />
        <path d="M206 132 L214 112 L222 134" />
        <path d="M98 190 V214 M120 192 V216 M166 192 V216 M186 186 V210" />
        <path d="M72 156 q-14 -4 -12 -14 q4 -8 10 -2" />
        <path className="thin" d="M30 222 H270" />
      </>
    )
  },
  cattle: {
    viewBox: '0 0 300 240',
    label: 'The cattle of the sun',
    body: (
      <>
        {/* Helios watching */}
        <circle cx="258" cy="42" r="17" />
        <path className="thin" d="M258 14 V6 M258 78 V70 M230 42 H222 M294 42 H286 M238 22 L232 16 M278 22 L284 16 M238 62 L232 68 M278 62 L284 68" />
        {/* the sacred bull */}
        <path d="M60 124 Q60 92 110 90 L196 90 Q234 94 234 126 Q234 152 218 158 L90 158 Q62 154 60 124 Z" />
        <path d="M62 112 Q40 98 30 114 Q24 130 36 142 Q48 148 60 138" />
        <path d="M40 104 Q18 82 28 64 M52 100 Q66 78 84 78" />
        <circle className="fill" cx="42" cy="118" r="2.4" />
        <path d="M84 158 V202 M102 158 V204 M196 158 V202 M214 156 V200" />
        <path d="M234 112 Q250 132 244 172 M244 172 l-4 8 l6 -2" />
        <path className="thin" d="M110 110 Q150 100 190 110 M120 136 Q150 130 186 138" />
        <path className="thin" d="M14 206 H286 M40 206 l-4 -8 M44 206 l0 -9 M150 206 l-3 -8 M154 206 l2 -9 M250 206 l-3 -8 M254 206 l2 -9" />
      </>
    )
  },
  argos: {
    viewBox: '0 0 280 200',
    label: 'Argos the faithful dog',
    body: (
      <>
        <path d="M70 150 Q70 120 108 116 L190 116 Q220 120 222 146 Q220 160 200 162 L88 162 Q70 160 70 150 Z" />
        <path d="M78 126 Q66 98 80 86 Q96 76 108 90 Q112 102 104 112" />
        <path d="M80 86 L54 94 Q48 102 58 104 L78 102" />
        <circle className="fill" cx="53" cy="98" r="2.4" /><circle className="fill" cx="86" cy="92" r="2.2" />
        <path d="M94 86 Q106 94 100 114" />
        <path d="M78 162 L44 166 M88 162 L54 172" />
        <path d="M222 148 Q252 150 264 138" />
        <path className="thin" d="M124 124 q4 14 0 30 M140 122 q4 14 0 32 M156 122 q4 14 0 32 M172 122 q4 14 0 32" />
        <path className="thin" d="M16 176 Q140 164 272 176 M40 176 l-4 -8 M120 172 l-2 -8 M200 172 l2 -8 M250 174 l4 -8" />
      </>
    )
  },
  loom: {
    viewBox: '0 0 240 280',
    label: "Penelope's loom",
    body: (
      <>
        <path d="M40 272 L60 18 M200 272 L180 18" />
        <path d="M48 30 H192 M54 104 H186" />
        <path className="thin" d="M70 34 V226 M80 34 V226 M90 34 V226 M100 34 V226 M110 34 V226 M120 34 V226 M130 34 V226 M140 34 V226 M150 34 V226 M160 34 V226 M170 34 V226" />
        <path className="thin" d="M66 44 H174 M66 54 H174 M66 64 H174 M66 74 H174 M66 84 H174 M66 94 H174" />
        <path className="thin" d="M60 172 L180 156" />
        <circle cx="70" cy="244" r="5" /><circle cx="80" cy="236" r="5" /><circle cx="90" cy="244" r="5" /><circle cx="100" cy="236" r="5" /><circle cx="110" cy="244" r="5" /><circle cx="120" cy="236" r="5" /><circle cx="130" cy="244" r="5" /><circle cx="140" cy="236" r="5" /><circle cx="150" cy="244" r="5" /><circle cx="160" cy="236" r="5" /><circle cx="170" cy="244" r="5" />
        <path className="thin" d="M20 274 H220" />
      </>
    )
  }
}

export function OdysseyArt({ name, className, style }: { name: ArtName; className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className ? `art ${className}` : 'art'} style={style} viewBox={ART[name].viewBox} aria-hidden="true" focusable="false">
      <g className="art-lines">{ART[name].body}</g>
    </svg>
  )
}

// Scenes of calm and homecoming, for a working tree with nothing left to do.
export const CALM_SCENES: ArtName[] = ['calypso', 'argos', 'loom', 'owl', 'lotus', 'amphora']
