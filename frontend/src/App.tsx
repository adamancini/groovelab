import { BrowserRouter, Route, Routes } from "react-router";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import NavBar from "./components/NavBar";
import SkipLink from "./components/SkipLink";
import UpdateBanner from "./components/UpdateBanner";
import Home from "./pages/Home";
import SignIn from "./pages/auth/SignIn";
import Register from "./pages/auth/Register";
import Placeholder from "./pages/Placeholder";
import Learn from "./pages/Learn";
import FlashcardSession from "./pages/FlashcardSession";
import AdminLayout from "./pages/admin/AdminLayout";
import Updates from "./pages/admin/Updates";
import Users from "./pages/admin/Users";
import AdminTracks from "./pages/admin/Tracks";
import License from "./pages/admin/License";
import Support from "./pages/admin/Support";
import FretboardRef from "./pages/FretboardRef";
import Progress from "./pages/Progress";

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <SkipLink />
          <UpdateBanner />
          <NavBar />
          <main id="main-content">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/learn" element={<Learn />} />
              <Route
                path="/learn/:topic"
                element={<FlashcardSession />}
              />
              <Route path="/play" element={<Placeholder title="Play" />} />
              <Route
                path="/play/:id"
                element={<Placeholder title="Track Playback" />}
              />
              <Route path="/fretboard" element={<FretboardRef />} />
              <Route path="/progress" element={<Progress />} />
              <Route path="/auth/signin" element={<SignIn />} />
              <Route path="/auth/register" element={<Register />} />
              <Route
                path="/settings"
                element={<Placeholder title="Settings" />}
              />
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Updates />} />
                <Route path="users" element={<Users />} />
                <Route path="tracks" element={<AdminTracks />} />
                <Route path="license" element={<License />} />
                <Route path="support" element={<Support />} />
              </Route>
              <Route
                path="*"
                element={<Placeholder title="Page Not Found" />}
              />
            </Routes>
          </main>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
