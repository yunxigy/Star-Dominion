import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 600000,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg = err.response?.data?.detail || err.response?.data?.error || err.message
    return Promise.reject(new Error(msg))
  }
)

export default api
