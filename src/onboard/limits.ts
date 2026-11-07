/*
 * Limits shared by the onboarding form (src/onboard) and its API (api/).
 * Pure data and string helpers only: no DOM and no Node APIs.
 */

/** Field length limits (characters). */
export const MAX = {
  name: 80,
  title: 80,
  company: 80,
  phone: 24,
  email: 120,
  url: 300,
  tagline: 60,
  bio: 300,
  notes: 1000,
} as const

export const MAX_SOCIALS = 8
export const MAX_CARD_FILES = 2
export const MAX_FILES = 5 // logo + photo + 2 card sides, with one spare
/** After client-side processing, all files together (stays under Vercel's 4.5MB body limit). */
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024
/** Any single file, as the server receives it. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024
/** Largest file the picker accepts, before resizing. */
export const MAX_PICK_BYTES = 10 * 1024 * 1024
/** Seconds a person needs at minimum to fill in the form (spam check). */
export const MIN_FILL_SECONDS = 8

export const PLATFORMS = ['LinkedIn', 'Instagram', 'X', 'Facebook', 'TikTok', 'YouTube', 'Other'] as const
export type Platform = (typeof PLATFORMS)[number]
export type Social = { platform: Platform; url: string }

/** Every text value the form sends (files are sent separately). */
export type Brief = {
  /** The card is a gift / someone else is filling it in. */
  gift: boolean
  ordererName: string
  ordererPhone: string
  name: string
  title: string
  company: string
  /** WhatsApp number (required). */
  phone: string
  phone2: string
  email: string
  website: string
  socials: Social[]
  bio: string
  tagline: string
  notes: string
  consent: boolean
  /** When the consent box was ticked (ISO time, from the browser). */
  consentAt: string
}

export const EMPTY_BRIEF: Brief = {
  gift: false,
  ordererName: '',
  ordererPhone: '',
  name: '',
  title: '',
  company: '',
  phone: '',
  phone2: '',
  email: '',
  website: '',
  socials: [],
  bio: '',
  tagline: '',
  notes: '',
  consent: false,
  consentAt: '',
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Digits only, 7-15 of them (an optional leading + and spaces/dashes/brackets allowed). */
export function isPhone(v: string): boolean {
  if (!/^\+?[\d\s()-]+$/.test(v)) return false
  const digits = v.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}

/** Accepts "example.com" or "https://example.com"; rejects anything that isn't http(s). */
export function isWebUrl(v: string): boolean {
  const s = /^[a-z][a-z\d+.-]*:/i.test(v) ? v : `https://${v}`
  try {
    const u = new URL(s)
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.')
  } catch {
    return false
  }
}

/** A profile link, or an @handle. */
export function isProfile(v: string): boolean {
  return /^@[A-Za-z0-9._-]{1,40}$/.test(v) || isWebUrl(v)
}

export type FieldErrors = Partial<Record<string, string>>

/**
 * Validates the whole brief. Used by the form (inline, on blur and on
 * submit) and by the server before anything is emailed. Only the card
 * owner's name, WhatsApp number and consent are required (plus the
 * orderer's name and number when the card is a gift).
 */
export function validateBrief(b: Brief): FieldErrors {
  const e: FieldErrors = {}
  const len = (k: string, v: string, max: number) => {
    if (v.length > max) e[k] = `Please keep this under ${max} characters.`
  }
  const whose = b.gift ? "the card owner's" : 'your'

  if (b.gift) {
    if (!b.ordererName.trim()) e.ordererName = 'Please enter your name.'
    if (!b.ordererPhone.trim()) e.ordererPhone = 'Please enter your number so we can reach you.'
    else if (!isPhone(b.ordererPhone.trim())) e.ordererPhone = "That number doesn't look right. Please check it, e.g. +254 712 345 678."
    len('ordererName', b.ordererName, MAX.name)
  }

  if (!b.name.trim()) e.name = `Please enter ${whose} full name.`
  if (!b.phone.trim()) e.phone = `Please enter ${whose} WhatsApp number.`
  else if (!isPhone(b.phone.trim())) e.phone = "That number doesn't look right. Please check it, e.g. +254 712 345 678."
  if (b.phone2.trim() && !isPhone(b.phone2.trim())) e.phone2 = "That number doesn't look right. Please check it."
  if (b.email.trim() && !EMAIL_RE.test(b.email.trim())) e.email = 'Please check the email address, e.g. name@company.com.'
  if (b.website.trim() && !isWebUrl(b.website.trim())) e.website = 'Please enter a web address, e.g. company.com.'
  len('name', b.name, MAX.name)
  len('title', b.title, MAX.title)
  len('company', b.company, MAX.company)
  len('email', b.email, MAX.email)
  len('website', b.website, MAX.url)

  if (b.socials.length > MAX_SOCIALS) e.socials = `Up to ${MAX_SOCIALS} social links.`
  b.socials.forEach((s, i) => {
    if (!(PLATFORMS as readonly string[]).includes(s.platform)) e[`social${i}platform`] = 'Please choose a platform.'
    if (s.url.trim() && !isProfile(s.url.trim())) e[`social${i}url`] = 'Please paste the profile link, e.g. instagram.com/yourname.'
    len(`social${i}url`, s.url, MAX.url)
  })

  len('bio', b.bio, MAX.bio)
  len('tagline', b.tagline, MAX.tagline)
  len('notes', b.notes, MAX.notes)
  if (!b.consent) e.consent = 'Please tick this box so we can make the card and profile.'
  return e
}
