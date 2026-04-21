import "./globals.css";
import InnerLayout from "./InnerLayout";
import { THEMES } from "@/themes/themes";

export const metadata = {
  title: "Pulse",
  description: "Keep your terminals alive",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

const DARK_IDS = THEMES.filter(t => t.base === 'dark').map(t => t.id);
const LIGHT_IDS = THEMES.filter(t => t.base === 'light').map(t => t.id);

const THEME_INIT_SCRIPT = `
(function(){
  try {
    var DARK = ${JSON.stringify(DARK_IDS)};
    var LIGHT = ${JSON.stringify(LIGHT_IDS)};
    var stored = localStorage.getItem('rt:theme');
    var theme = (DARK.indexOf(stored) >= 0 || LIGHT.indexOf(stored) >= 0) ? stored : 'dark';
    var root = document.documentElement;
    if (LIGHT.indexOf(theme) >= 0) { root.classList.add('light'); }
    else { root.classList.add('dark'); }
    if (theme !== 'dark' && theme !== 'light') { root.classList.add('theme-' + theme); }
    var locale = localStorage.getItem('rt:locale');
    if (locale) root.lang = locale;
  } catch (e) {}
})();
`;

export default function RootLayout({ children }) {
  return (
    <html suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="antialiased">
        <InnerLayout>{children}</InnerLayout>
      </body>
    </html>
  );
}
