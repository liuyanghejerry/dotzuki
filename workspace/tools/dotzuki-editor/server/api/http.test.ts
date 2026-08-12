import { describe, expect, it } from 'vitest'
import { Readable } from 'stream'
import { parseUrl, readBody, sendError, sendJson } from './http'
import { mockReq, mockRes } from './testUtils'

describe('sendJson', () => {
  it('sends a JSON body with a default 200 status', () => {
    const res = mockRes()
    sendJson(res, { hello: '世界' })
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ hello: '世界' })
  })

  it('honors a custom status', () => {
    const res = mockRes()
    sendJson(res, { id: 1 }, 201)
    expect(res.status).toBe(201)
    expect(res.json()).toEqual({ id: 1 })
  })
})

describe('sendError', () => {
  it('defaults to 404 with an {error} body', () => {
    const res = mockRes()
    sendError(res, 'not found')
    expect(res.status).toBe(404)
    expect(res.json()).toEqual({ error: 'not found' })
  })

  it('honors a custom status', () => {
    const res = mockRes()
    sendError(res, 'bad input', 400)
    expect(res.status).toBe(400)
    expect(res.json()).toEqual({ error: 'bad input' })
  })
})

describe('readBody', () => {
  it('resolves with the request body', async () => {
    const req = mockReq('POST', { a: 1 })
    await expect(readBody(req)).resolves.toBe('{"a":1}')
  })

  it('concatenates multiple stream chunks', async () => {
    const req = new Readable({ read() {} }) as any
    req.push('hello ')
    req.push(Buffer.from('世界'))
    req.push(null)
    await expect(readBody(req)).resolves.toBe('hello 世界')
  })

  it('rejects when the stream errors', async () => {
    const req = new Readable({ read() {} }) as any
    const body = readBody(req)
    req.emit('error', new Error('boom'))
    await expect(body).rejects.toThrow('boom')
  })
})

describe('parseUrl', () => {
  it('parses path and query params', () => {
    const url = parseUrl(mockReq('GET', undefined, '/api/data?file=a.json&pretty=1'))
    expect(url.pathname).toBe('/api/data')
    expect(url.searchParams.get('file')).toBe('a.json')
    expect(url.searchParams.get('pretty')).toBe('1')
  })

  it('uses req.headers.host as the URL base', () => {
    const req = mockReq('GET', undefined, '/x')
    req.headers.host = 'example.com:3000'
    expect(parseUrl(req).host).toBe('example.com:3000')
  })

  it('defaults to localhost when the host header is missing', () => {
    const req = mockReq('GET', undefined, '/x')
    req.headers = {}
    expect(parseUrl(req).host).toBe('localhost')
  })

  it('treats a missing url as /', () => {
    const req = mockReq('GET')
    req.url = undefined
    expect(parseUrl(req).pathname).toBe('/')
  })
})
