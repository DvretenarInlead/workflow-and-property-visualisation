import { useRef, useState, useEffect } from 'react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'Which workflows write to lifecyclestage?',
  'What does the Lead Nurturing workflow do?',
  'If I rename dealstage, what breaks?',
  'Which properties are written but never read?',
]

/**
 * Chat panel that talks to the /api/chat proxy. The server injects the workflow
 * dataset as context and streams Claude's reply back as plain text.
 */
export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streaming])

  async function send(text: string) {
    const question = text.trim()
    if (!question || streaming) return
    setError(null)
    setInput('')

    const history = [...messages, { role: 'user', content: question } as ChatMessage]
    setMessages([...history, { role: 'assistant', content: '' }])
    setStreaming(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      })
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '')
        throw new Error(detail || `Request failed (${res.status})`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setMessages((prev) => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: acc }
          return next
        })
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
      setMessages((prev) => prev.slice(0, -1)) // drop the empty assistant bubble
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="chat">
      <div className="chat__scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat__intro">
            <h2>Ask about your workflows</h2>
            <p className="muted">
              I can see every workflow and the properties they read and write. Ask about dependencies,
              what a workflow does, or the impact of changing a property.
            </p>
            <div className="chat__suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chat__chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble bubble--${m.role}`}>
            <div className="bubble__role">{m.role === 'user' ? 'You' : 'Assistant'}</div>
            <div className="bubble__content">
              {m.content || (streaming && i === messages.length - 1 ? <span className="cursor">▋</span> : '')}
            </div>
          </div>
        ))}
        {error && <div className="chat__error">⚠ {error}</div>}
      </div>

      <form
        className="chat__composer"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <input
          className="input"
          placeholder="Ask about workflows, properties, dependencies…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={streaming}
        />
        <button className="btn btn--primary" type="submit" disabled={streaming || !input.trim()}>
          {streaming ? '…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
