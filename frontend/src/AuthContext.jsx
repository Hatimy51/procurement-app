import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading') // 'loading' | 'needs-setup' | 'logged-out' | 'logged-in'
  const [user, setUser] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const me = await api.getMe()
      setUser(me)
      setStatus('logged-in')
      return
    } catch {
      // not logged in — fall through to check whether setup is needed
    }
    try {
      const boot = await api.getBootstrapStatus()
      setStatus(boot.needs_setup ? 'needs-setup' : 'logged-out')
    } catch {
      setStatus('logged-out')
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function logout() {
    await api.logout()
    setUser(null)
    setStatus('logged-out')
  }

  return (
    <AuthContext.Provider value={{ status, user, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
