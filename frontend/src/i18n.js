import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      "Welcome": "Welcome to the Petanque results and standings website!"
    }
  },
  nl: {
    translation: {
      "Welcome": "Welkom op de Petanque NPC standen website!"
    }
  },
  fr: {
    translation: {
      "Welcome": "Bienvenue sur le site des résultats et classements de pétanque!"
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: "en",
    fallbackLng: "en",
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
