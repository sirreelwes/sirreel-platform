import React from 'react'
import { Text, View } from '@react-pdf/renderer'
import { hyphenateWord } from './hyphenation'

type StyleProp = React.ComponentProps<typeof View>['style']

/**
 * An inventory code in a narrow column — folds at its separators and
 * prints NO extra hyphen where it folds.
 *
 * WHY not just the hyphenation callback: @react-pdf/textkit inserts a
 * HYPHEN glyph at every break it takes inside a word, whatever the
 * callback returned (textkit `breakLines`: a penalty node always gets
 * `insertGlyph(HYPHEN)`). So a code that folds through the callback
 * prints "CAT_CUBE_-" / "TRUCK" and "VEH---" / "STRAPS---" / "RATCHET" —
 * the wrapped lines no longer read as the code on the label, which is
 * what the floor matches against. Rendering each separator-terminated
 * part as its own Text inside a wrapping row lets Yoga fold the code at
 * the same places with nothing added: "CAT_CUBE_" / "TRUCK".
 *
 * A code with nothing to fold at renders as a plain Text and the
 * hyphenation policy still chunks it if it outruns the column.
 */
export function CodeText({ code, style }: { code: string; style?: StyleProp }) {
  const parts = hyphenateWord(code)
  if (parts.length < 2) return <Text style={style}>{code}</Text>
  const extra = style === undefined ? [] : Array.isArray(style) ? style : [style]
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap' }, ...extra]}>
      {parts.map((part, i) => (
        <Text key={i}>{part}</Text>
      ))}
    </View>
  )
}
