const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen ']
const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function inWords(num) {
  if ((num = num.toString()).length > 9) return 'Overflow'
  const n = ('000000000' + num).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/)
  if (!n) return ''
  let str = ''
  str += n[1] != 0 ? (a[Number(n[1])] || b[n[1][0]] + ' ' + a[n[1][1]]) + 'Crore ' : ''
  str += n[2] != 0 ? (a[Number(n[2])] || b[n[2][0]] + ' ' + a[n[2][1]]) + 'Lakh ' : ''
  str += n[3] != 0 ? (a[Number(n[3])] || b[n[3][0]] + ' ' + a[n[3][1]]) + 'Thousand ' : ''
  str += n[4] != 0 ? (a[Number(n[4])] || b[n[4][0]] + ' ' + a[n[4][1]]) + 'Hundred ' : ''
  str += n[5] != 0 ? (str != '' ? 'and ' : '') + (a[Number(n[5])] || b[n[5][0]] + ' ' + a[n[5][1]]) : ''
  return str.trim()
}

export function numberToRupeesWords(amount) {
  if (amount == null || isNaN(amount)) return ''
  const num = Number(amount)
  if (num === 0) return 'Rupees Zero Only'

  const parts = num.toFixed(2).split('.')
  const rupees = parseInt(parts[0], 10)
  const paise = parseInt(parts[1], 10)

  let result = 'Rupees '
  if (rupees > 0) {
    result += inWords(rupees) + ' '
  } else {
    result += 'Zero '
  }

  if (paise > 0) {
    result += 'and ' + inWords(paise) + ' Paise '
  }

  result += 'Only'
  return result
}
