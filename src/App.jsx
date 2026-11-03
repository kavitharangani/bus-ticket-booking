import { Routes, Route, Link } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import { useT } from './i18n/index.js'
import Search from './pages/Search.jsx'
import Results from './pages/Results.jsx'
import Book from './pages/Book.jsx'
import Ticket from './pages/Ticket.jsx'
import MyTickets from './pages/MyTickets.jsx'
import BusTimes from './pages/BusTimes.jsx'
import Track from './pages/Track.jsx'
import PayTest from './pages/PayTest.jsx'

function NotFound() {
  const t = useT()
  return (
    <div className="empty">
      <h1>{t('notFound.title')}</h1>
      <Link className="btn btn-primary" to="/">{t('notFound.back')}</Link>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Search />} />
        <Route path="results" element={<Results />} />
        <Route path="book/:tripId/:date" element={<Book />} />
        <Route path="tickets" element={<MyTickets />} />
        <Route path="tickets/:ref" element={<Ticket />} />
        <Route path="pay/test/:ref" element={<PayTest />} />
        <Route path="times" element={<BusTimes />} />
        <Route path="track/:tripId/:date" element={<Track />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
