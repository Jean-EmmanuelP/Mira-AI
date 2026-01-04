#!/bin/bash
# Mira - Lancement complet (serveur + chat + onboarding + audio)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m'
BOLD='\033[1m'

SERVER_URL="http://localhost:3000"
USER_ID=""
AUDIO_DIR="/tmp/mira-audio"
HAS_SOX=false
HAS_AUDIO=false

# ===========================================
# LANGUAGE CONFIGURATION
# ===========================================
LANG_MODE="fr"  # Default: French

# Get localized string - compatible with all shells
L() {
    local key="$1"
    if [ "$LANG_MODE" = "en" ]; then
        case "$key" in
            welcome) echo "Welcome" ;;
            your_name) echo "What's your name?" ;;
            who_are_you) echo "Who are you?" ;;
            new) echo "New" ;;
            delete_user) echo "Delete a user" ;;
            delete_all) echo "Delete ALL users" ;;
            your_choice) echo "Your choice" ;;
            nice_to_see_you) echo "Good to see you again" ;;
            invalid_choice) echo "Invalid choice..." ;;
            first_connection) echo "First connection!" ;;
            loading) echo "Loading..." ;;
            mira_writes) echo "Mira is typing" ;;
            seen) echo "seen" ;;
            quit_msg) echo "See you soon" ;;
            commands_help) echo "Available commands" ;;
            record_audio) echo "Record an audio message" ;;
            view_history) echo "View conversation history" ;;
            clear_data) echo "Clear all your data" ;;
            reconfigure) echo "Reconfigure API keys" ;;
            show_help) echo "Show this help" ;;
            quit) echo "Quit" ;;
            confirm_delete) echo "Are you sure? (type 'yes' to confirm)" ;;
            deleted) echo "Data deleted" ;;
            cancelled) echo "Cancelled" ;;
            recent_history) echo "Recent history" ;;
            no_history) echo "No history with you yet!" ;;
            recording) echo "VOICE RECORDING" ;;
            press_enter_stop) echo "Press ENTER to STOP" ;;
            audio_recorded) echo "Audio recorded" ;;
            recording_too_short) echo "Recording too short" ;;
            sending_audio) echo "Sending audio..." ;;
            ongoing_convo) echo "Ongoing conversation" ;;
            checking_deps) echo "Checking dependencies..." ;;
            starting_server) echo "Starting Mira server..." ;;
            connecting) echo "Connecting" ;;
            server_ready) echo "Server ready!" ;;
            server_error) echo "Error: Server did not start" ;;
            stopping) echo "Stopping Mira..." ;;
            your_friend) echo "Your friend who truly knows you" ;;
            warning_delete_all) echo "This will delete ALL your data!" ;;
            messages) echo "Messages" ;;
            memories) echo "Memories" ;;
            goals) echo "Goals" ;;
            events) echo "Events" ;;
            profile) echo "Profile" ;;
            deleting) echo "Deleting..." ;;
            restart_fresh) echo "You can start over as if we never met!" ;;
            type_help) echo "Type '/help' for commands." ;;
            audio_enabled) echo "Audio mode enabled: /audio to record" ;;
            last_convo) echo "Last conversation" ;;
            visualize_mic) echo "Visualize microphone" ;;
            delete_all_warning) echo "DELETING ALL USERS" ;;
            all_users_data) echo "This will delete ALL data for ALL users:" ;;
            irreversible) echo "This action is IRREVERSIBLE!" ;;
            type_yes) echo "Type 'yes' to confirm:" ;;
            users_deleted) echo "user(s) deleted" ;;
            db_cleared) echo "Database cleared!" ;;
            which_user_delete) echo "Which user to delete?" ;;
            cancel) echo "Cancel" ;;
            number) echo "Number" ;;
            really_delete) echo "Really delete" ;;
            user_deleted) echo "User deleted" ;;
            confirm_word) echo "yes" ;;
            sox_available) echo "SoX available (audio recording enabled)" ;;
            sox_not_installed) echo "SoX not installed - Audio mode disabled" ;;
            install_sox) echo "Do you want to install SoX for audio? (y/N)" ;;
            installing_sox) echo "Installing SoX..." ;;
            sox_installed) echo "SoX installed successfully!" ;;
            install_failed) echo "Installation failed" ;;
            to_enable) echo "To enable: brew install sox" ;;
            *) echo "$key" ;;
        esac
    else
        case "$key" in
            welcome) echo "Bienvenue" ;;
            your_name) echo "Comment tu t'appelles ?" ;;
            who_are_you) echo "Qui es-tu ?" ;;
            new) echo "Nouveau" ;;
            delete_user) echo "Supprimer un utilisateur" ;;
            delete_all) echo "Supprimer TOUS les utilisateurs" ;;
            your_choice) echo "Ton choix" ;;
            nice_to_see_you) echo "Content de te revoir" ;;
            invalid_choice) echo "Choix invalide..." ;;
            first_connection) echo "Première connexion !" ;;
            loading) echo "Chargement..." ;;
            mira_writes) echo "Mira écrit" ;;
            seen) echo "vu" ;;
            quit_msg) echo "À bientôt" ;;
            commands_help) echo "Commandes disponibles" ;;
            record_audio) echo "Enregistrer un message audio" ;;
            view_history) echo "Voir l'historique de conversation" ;;
            clear_data) echo "Effacer toutes tes données" ;;
            reconfigure) echo "Reconfigurer les clés API" ;;
            show_help) echo "Afficher cette aide" ;;
            quit) echo "Quitter" ;;
            confirm_delete) echo "Es-tu sûr ? (tape 'oui' pour confirmer)" ;;
            deleted) echo "Données supprimées" ;;
            cancelled) echo "Annulé" ;;
            recent_history) echo "Historique récent" ;;
            no_history) echo "Pas encore d'historique avec toi !" ;;
            recording) echo "ENREGISTREMENT VOCAL" ;;
            press_enter_stop) echo "Appuie sur ENTRÉE pour ARRÊTER" ;;
            audio_recorded) echo "Audio enregistré" ;;
            recording_too_short) echo "Enregistrement trop court" ;;
            sending_audio) echo "Envoi de l'audio..." ;;
            ongoing_convo) echo "Conversation en cours" ;;
            checking_deps) echo "Vérification des dépendances..." ;;
            starting_server) echo "Démarrage du serveur Mira..." ;;
            connecting) echo "Connexion" ;;
            server_ready) echo "Serveur prêt!" ;;
            server_error) echo "Erreur: Le serveur n'a pas démarré" ;;
            stopping) echo "Arrêt de Mira..." ;;
            your_friend) echo "Ton amie qui te connaît vraiment" ;;
            warning_delete_all) echo "Cela va supprimer TOUTES tes données !" ;;
            messages) echo "Messages" ;;
            memories) echo "Mémoires" ;;
            goals) echo "Objectifs" ;;
            events) echo "Événements" ;;
            profile) echo "Profil" ;;
            deleting) echo "Suppression en cours..." ;;
            restart_fresh) echo "Tu peux recommencer comme si on ne s'était jamais rencontrés !" ;;
            type_help) echo "Tape '/help' pour les commandes." ;;
            audio_enabled) echo "Mode audio activé: /audio pour enregistrer" ;;
            last_convo) echo "Dernière conversation" ;;
            visualize_mic) echo "Visualiser le micro" ;;
            delete_all_warning) echo "SUPPRESSION DE TOUS LES UTILISATEURS" ;;
            all_users_data) echo "Cela va supprimer TOUTES les données de TOUS les utilisateurs:" ;;
            irreversible) echo "Cette action est IRRÉVERSIBLE !" ;;
            type_yes) echo "Tape 'oui' pour confirmer:" ;;
            users_deleted) echo "utilisateur(s) supprimé(s)" ;;
            db_cleared) echo "Base de données vidée !" ;;
            which_user_delete) echo "Quel utilisateur supprimer ?" ;;
            cancel) echo "Annuler" ;;
            number) echo "Numéro" ;;
            really_delete) echo "Vraiment supprimer" ;;
            user_deleted) echo "Utilisateur supprimé" ;;
            confirm_word) echo "oui" ;;
            sox_available) echo "SoX disponible (enregistrement audio activé)" ;;
            sox_not_installed) echo "SoX non installé - Mode audio désactivé" ;;
            install_sox) echo "Veux-tu installer SoX pour l'audio ? (o/N)" ;;
            installing_sox) echo "Installation de SoX..." ;;
            sox_installed) echo "SoX installé avec succès!" ;;
            install_failed) echo "Échec de l'installation" ;;
            to_enable) echo "Pour activer: brew install sox" ;;
            *) echo "$key" ;;
        esac
    fi
}

# Language selection at startup
select_language() {
    echo ""
    echo -e "${PURPLE}${BOLD}🌍 Language / Langue${NC}"
    echo ""
    echo -e "  ${GREEN}1)${NC} Français"
    echo -e "  ${GREEN}2)${NC} English"
    echo ""
    echo -ne "${PURPLE}> ${NC}"
    read -r lang_choice

    case "$lang_choice" in
        2|en|EN|english|English)
            LANG_MODE="en"
            echo -e "${GREEN}✓ English selected${NC}"
            ;;
        *)
            LANG_MODE="fr"
            echo -e "${GREEN}✓ Français sélectionné${NC}"
            ;;
    esac
    sleep 0.5
}

# ===========================================
# SETUP WIZARD - Configure .env if needed
# ===========================================

setup_env() {
    clear
    echo -e "${PURPLE}${BOLD}"
    echo "  ╔══════════════════════════════════════════╗"
    echo "  ║                                          ║"
    echo "  ║     🌟 Bienvenue dans Mira Setup 🌟      ║"
    echo "  ║                                          ║"
    echo "  ╚══════════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
    echo -e "${CYAN}Mira est une IA conversationnelle émotionnelle qui se souvient de toi.${NC}"
    echo -e "${GRAY}Pour fonctionner, elle a besoin d'une clé API pour un modèle LLM.${NC}"
    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${BOLD}Choisis ton modèle LLM :${NC}"
    echo ""
    echo -e "  ${GREEN}1)${NC} ${BOLD}Google Gemini${NC} ${GRAY}(Recommandé - gratuit avec quota)${NC}"
    echo -e "     ${GRAY}→ https://aistudio.google.com/apikey${NC}"
    echo ""
    echo -e "  ${GREEN}2)${NC} ${BOLD}Anthropic Claude${NC} ${GRAY}(Payant - très bon)${NC}"
    echo -e "     ${GRAY}→ https://console.anthropic.com/settings/keys${NC}"
    echo ""
    echo -e "  ${GREEN}3)${NC} ${BOLD}Mistral AI${NC} ${GRAY}(Gratuit avec quota)${NC}"
    echo -e "     ${GRAY}→ https://console.mistral.ai/api-keys${NC}"
    echo ""
    echo -e "  ${GREEN}4)${NC} ${BOLD}Configurer plusieurs${NC} ${GRAY}(fallback automatique)${NC}"
    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -ne "${PURPLE}Ton choix (1-4): ${NC}"
    read -r llm_choice

    # Initialize variables
    local gemini_key=""
    local claude_key=""
    local mistral_key=""

    case "$llm_choice" in
        1)
            echo ""
            echo -e "${CYAN}📝 Configuration de Google Gemini${NC}"
            echo -e "${GRAY}Crée ta clé ici: https://aistudio.google.com/apikey${NC}"
            echo ""
            echo -ne "${GREEN}Colle ta clé API Gemini: ${NC}"
            read -r gemini_key
            ;;
        2)
            echo ""
            echo -e "${CYAN}📝 Configuration d'Anthropic Claude${NC}"
            echo -e "${GRAY}Crée ta clé ici: https://console.anthropic.com/settings/keys${NC}"
            echo ""
            echo -ne "${GREEN}Colle ta clé API Claude: ${NC}"
            read -r claude_key
            ;;
        3)
            echo ""
            echo -e "${CYAN}📝 Configuration de Mistral AI${NC}"
            echo -e "${GRAY}Crée ta clé ici: https://console.mistral.ai/api-keys${NC}"
            echo ""
            echo -ne "${GREEN}Colle ta clé API Mistral: ${NC}"
            read -r mistral_key
            ;;
        4)
            echo ""
            echo -e "${CYAN}📝 Configuration multi-modèles${NC}"
            echo -e "${GRAY}Mira utilisera le premier disponible dans l'ordre.${NC}"
            echo -e "${GRAY}Laisse vide pour ignorer un modèle.${NC}"
            echo ""
            echo -ne "${GREEN}Clé API Gemini (ou Entrée pour ignorer): ${NC}"
            read -r gemini_key
            echo -ne "${GREEN}Clé API Claude (ou Entrée pour ignorer): ${NC}"
            read -r claude_key
            echo -ne "${GREEN}Clé API Mistral (ou Entrée pour ignorer): ${NC}"
            read -r mistral_key
            ;;
        *)
            echo -e "${RED}Choix invalide. Utilisation de Gemini par défaut.${NC}"
            echo ""
            echo -ne "${GREEN}Colle ta clé API Gemini: ${NC}"
            read -r gemini_key
            ;;
    esac

    # Check if at least one key was provided
    if [ -z "$gemini_key" ] && [ -z "$claude_key" ] && [ -z "$mistral_key" ]; then
        echo ""
        echo -e "${RED}❌ Aucune clé API fournie !${NC}"
        echo -e "${GRAY}Mira a besoin d'au moins une clé API pour fonctionner.${NC}"
        echo ""
        echo -ne "${YELLOW}Réessayer ? (o/N): ${NC}"
        read -r retry
        if [[ "$retry" =~ ^[OoYy]$ ]]; then
            setup_env
            return
        else
            echo -e "${RED}Abandon du setup.${NC}"
            exit 1
        fi
    fi

    # Local config by default
    local mongodb_uri="mongodb://localhost:27017/mira"
    local qdrant_host="localhost"
    local qdrant_port="6333"

    # Generate .env file
    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}📝 Création du fichier .env...${NC}"

    cat > .env << EOF
# ===========================================
# Mira Configuration - Generated by setup
# ===========================================

# Server
PORT=3000
NODE_ENV=development

# MongoDB
MONGODB_URI=$mongodb_uri

# ===========================================
# LLM API Keys
# Models are tried in order: Gemini → Claude → Mistral
# ===========================================

# Google Gemini
GOOGLE_GENERATIVE_AI_API_KEY=$gemini_key

# Anthropic Claude
ANTHROPIC_API_KEY=$claude_key

# Mistral AI
MISTRAL_API_KEY=$mistral_key

# ===========================================
# Vector Database (Qdrant)
# ===========================================

QDRANT_HOST=$qdrant_host
QDRANT_PORT=$qdrant_port
EOF

    # Add remaining config
    cat >> .env << EOF

# ===========================================
# Optional Services
# ===========================================

# Redis (pour le cache - optionnel)
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=mira-secret-$(date +%s)
JWT_EXPIRY=7d

# Gradium TTS/STT (optionnel - pour les fonctionnalités vocales)
# GRADIUM_API_KEY=

# Hume AI (optionnel - pour l'analyse des émotions vocales)
# HUME_AI_API_KEY=
EOF

    echo -e "${GREEN}✓ Fichier .env créé avec succès !${NC}"
    echo ""

    # Show summary
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}📋 Résumé de ta configuration :${NC}"
    echo ""
    [ -n "$gemini_key" ] && echo -e "  ${GREEN}✓${NC} Google Gemini"
    [ -n "$claude_key" ] && echo -e "  ${GREEN}✓${NC} Anthropic Claude"
    [ -n "$mistral_key" ] && echo -e "  ${GREEN}✓${NC} Mistral AI"
    echo -e "  ${GREEN}✓${NC} MongoDB local (localhost:27017)"
    echo -e "  ${GREEN}✓${NC} Qdrant local (localhost:6333)"
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${YELLOW}⚠️  Assure-toi que MongoDB et Qdrant sont lancés !${NC}"
    echo ""
    echo -e "${GRAY}   MongoDB:  brew services start mongodb-community${NC}"
    echo -e "${GRAY}   Qdrant:   docker run -p 6333:6333 qdrant/qdrant${NC}"
    echo ""
    echo -ne "${GREEN}Appuie sur Entrée pour lancer Mira...${NC}"
    read -r
}

# Check if .env exists and has required keys
check_env() {
    local needs_setup=false

    # Check if .env exists
    if [ ! -f ".env" ]; then
        needs_setup=true
    else
        # Check if at least one LLM key is configured
        source .env 2>/dev/null

        local has_gemini=false
        local has_claude=false
        local has_mistral=false

        [ -n "$GOOGLE_GENERATIVE_AI_API_KEY" ] && has_gemini=true
        [ -n "$ANTHROPIC_API_KEY" ] && has_claude=true
        [ -n "$MISTRAL_API_KEY" ] && has_mistral=true

        if [ "$has_gemini" = "false" ] && [ "$has_claude" = "false" ] && [ "$has_mistral" = "false" ]; then
            needs_setup=true
        fi
    fi

    if [ "$needs_setup" = "true" ]; then
        setup_env
    fi
}

# ===========================================
# END SETUP WIZARD
# ===========================================

# Fonction cleanup
cleanup() {
    echo -e "\n${BLUE}$(L stopping)${NC}"
    pkill -f "tsx watch src/main.ts" 2>/dev/null
    lsof -ti:3000 | xargs kill -9 2>/dev/null
    rm -rf "$AUDIO_DIR" 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

# Vérifier les dépendances
check_deps() {
    echo -e "${BLUE}$(L checking_deps)${NC}"

    # jq (required)
    if ! command -v jq &> /dev/null; then
        echo -e "${YELLOW}jq n'est pas installé. Installation...${NC}"
        if command -v brew &> /dev/null; then
            brew install jq
        else
            echo -e "${RED}Impossible d'installer jq automatiquement. Installe-le manuellement.${NC}"
            exit 1
        fi
    fi

    # Node.js (required)
    if ! command -v node &> /dev/null; then
        echo -e "${RED}Node.js n'est pas installé!${NC}"
        exit 1
    fi

    # SoX (optional - for audio recording)
    if command -v sox &> /dev/null && command -v rec &> /dev/null; then
        HAS_SOX=true
        HAS_AUDIO=true
        echo -e "${GREEN}✓ $(L sox_available)${NC}"
    else
        echo -e "${YELLOW}$(L sox_not_installed)${NC}"
        if command -v brew &> /dev/null; then
            echo -ne "${CYAN}$(L install_sox) ${NC}"
            read -r install_sox
            if [[ "$install_sox" =~ ^[OoYy]$ ]]; then
                echo -e "${BLUE}$(L installing_sox)${NC}"
                brew install sox 2>/dev/null
                if command -v sox &> /dev/null; then
                    HAS_SOX=true
                    HAS_AUDIO=true
                    echo -e "${GREEN}✓ $(L sox_installed)${NC}"
                else
                    echo -e "${RED}$(L install_failed)${NC}"
                fi
            fi
        else
            echo -e "${GRAY}  $(L to_enable)${NC}"
        fi
    fi

    # Create audio temp directory
    mkdir -p "$AUDIO_DIR"
}

# Install audio dependencies
install_audio_deps() {
    echo -e "${YELLOW}Installation des dépendances audio...${NC}"

    if command -v brew &> /dev/null; then
        echo -e "${BLUE}Installation de SoX (enregistrement audio)...${NC}"
        brew install sox 2>/dev/null

        if command -v sox &> /dev/null; then
            HAS_SOX=true
            HAS_AUDIO=true
            echo -e "${GREEN}✓ SoX installé avec succès!${NC}"
        else
            echo -e "${RED}Échec de l'installation de SoX${NC}"
        fi
    else
        echo -e "${RED}Homebrew non disponible. Installe manuellement:${NC}"
        echo -e "${GRAY}  brew install sox${NC}"
    fi
}

# Démarrer le serveur
start_server() {
    echo -e "${BLUE}$(L starting_server)${NC}"

    # Kill ancien serveur si existe
    pkill -f "tsx watch src/main.ts" 2>/dev/null
    lsof -ti:3000 | xargs kill -9 2>/dev/null
    sleep 1

    # Lancer en background
    npm run dev > /tmp/mira-server.log 2>&1 &
    SERVER_PID=$!

    # Attendre que le serveur soit prêt
    echo -ne "${BLUE}$(L connecting)"
    for i in {1..20}; do
        if curl -s $SERVER_URL/health > /dev/null 2>&1; then
            echo -e "${NC}"
            echo -e "${GREEN}✓ $(L server_ready)${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
    done

    echo -e "${NC}"
    echo -e "${RED}✗ $(L server_error)${NC}"
    cat /tmp/mira-server.log
    exit 1
}

# Sélection de l'utilisateur
select_user() {
    clear
    echo -e "${PURPLE}"
    echo "  __  __ _           "
    echo " |  \/  (_)_ __ __ _ "
    echo " | |\/| | | '__/ _\` |"
    echo " | |  | | | | | (_| |"
    echo " |_|  |_|_|_|  \__,_|"
    echo -e "${NC}"
    echo -e "${BLUE}$(L your_friend)${NC}"
    echo ""

    # Récupérer les utilisateurs existants
    echo -e "${GRAY}$(L loading)${NC}"

    USERS_JSON=$(curl -s "$SERVER_URL/api/v1/users" 2>/dev/null)

    if [ -z "$USERS_JSON" ] || [ "$USERS_JSON" = "null" ]; then
        echo ""
        echo -e "${PURPLE}$(L your_name)${NC}"
        read -r USER_ID
        if [ -z "$USER_ID" ]; then
            USER_ID="ami"
        fi
        return
    fi

    # Parser les utilisateurs - Compatible with zsh/bash
    USERS=()
    while IFS= read -r user; do
        [ -n "$user" ] && USERS+=("$user")
    done < <(echo "$USERS_JSON" | jq -r '.users[]?' 2>/dev/null)

    if [ ${#USERS[@]} -eq 0 ]; then
        echo ""
        echo -e "${CYAN}$(L first_connection)${NC}"
        echo ""
        echo -e "${PURPLE}$(L your_name)${NC}"
        read -r USER_ID
        if [ -z "$USER_ID" ]; then
            USER_ID="ami"
        fi
        return
    fi

    echo ""
    echo -e "${CYAN}$(L who_are_you)${NC}"
    echo ""

    i=1
    for user in "${USERS[@]}"; do
        echo -e "  ${GREEN}$i)${NC} $user"
        ((i++))
    done
    echo ""
    echo -e "  ${GREEN}N)${NC} $(L new)"
    echo -e "  ${RED}D)${NC} $(L delete_user)"
    echo -e "  ${RED}X)${NC} $(L delete_all)"
    echo ""

    echo -ne "${PURPLE}$(L your_choice) : ${NC}"
    read -r choice

    if [[ "$choice" =~ ^[Nn]$ ]]; then
        echo -ne "${PURPLE}$(L your_name) ${NC}"
        read -r USER_ID
        if [ -z "$USER_ID" ]; then
            USER_ID="ami"
        fi
    elif [[ "$choice" =~ ^[Xx]$ ]]; then
        delete_all_users
    elif [[ "$choice" =~ ^[Dd]$ ]]; then
        delete_user_menu
    elif [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le ${#USERS[@]} ]; then
        USER_ID="${USERS[$((choice-1))]}"
        echo -e "${GREEN}$(L nice_to_see_you), $USER_ID !${NC}"
        sleep 1
    else
        echo -e "${YELLOW}$(L invalid_choice)${NC}"
        echo -ne "${PURPLE}$(L your_name) ${NC}"
        read -r USER_ID
        if [ -z "$USER_ID" ]; then
            USER_ID="ami"
        fi
    fi
}

# Delete ALL users
delete_all_users() {
    echo ""
    echo -e "${RED}╔══════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ⚠️  $(L delete_all_warning)  ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}$(L all_users_data)${NC}"
    echo -e "${GRAY}  - $(L messages)${NC}"
    echo -e "${GRAY}  - $(L memories)${NC}"
    echo -e "${GRAY}  - $(L goals)${NC}"
    echo -e "${GRAY}  - $(L events)${NC}"
    echo -e "${GRAY}  - $(L profile)${NC}"
    echo ""
    echo -e "${RED}$(L irreversible)${NC}"
    echo ""
    echo -ne "${RED}$(L type_yes) ${NC}"
    read -r confirm

    if [ "$confirm" = "$(L confirm_word)" ]; then
        echo ""
        echo -e "${YELLOW}$(L deleting)${NC}"

        # Get fresh list of users from API and delete each one
        local users_to_delete
        users_to_delete=$(curl -s "$SERVER_URL/api/v1/users" | jq -r '.users[]?' 2>/dev/null)

        local deleted=0
        if [ -n "$users_to_delete" ]; then
            echo "$users_to_delete" | while read -r user; do
                if [ -n "$user" ]; then
                    # URL encode the user (handle spaces and special chars)
                    local encoded_user
                    encoded_user=$(printf '%s' "$user" | jq -sRr @uri)
                    curl -s -X DELETE "$SERVER_URL/api/v1/users/$encoded_user" > /dev/null 2>&1
                    echo -e "${GRAY}  ✓ $user${NC}"
                fi
            done
            deleted=$(echo "$users_to_delete" | wc -l | tr -d ' ')
        fi

        # Clear the USERS array
        USERS=()

        echo ""
        echo -e "${GREEN}✓ $deleted $(L users_deleted)${NC}"
        echo ""
        echo -e "${CYAN}$(L db_cleared)${NC}"
        sleep 2

        # Go directly to new user prompt
        clear
        echo -e "${PURPLE}"
        echo "  __  __ _           "
        echo " |  \/  (_)_ __ __ _ "
        echo " | |\/| | | '__/ _\` |"
        echo " | |  | | | | | (_| |"
        echo " |_|  |_|_|_|  \__,_|"
        echo -e "${NC}"
        echo ""
        echo -e "${CYAN}$(L first_connection)${NC}"
        echo ""
        echo -ne "${PURPLE}$(L your_name) ${NC}"
        read -r USER_ID
        if [ -z "$USER_ID" ]; then
            USER_ID="ami"
        fi
        return
    else
        echo -e "${GRAY}$(L cancelled)${NC}"
        sleep 1
    fi

    # Retour au menu de sélection
    select_user
}

# Menu de suppression d'utilisateur
delete_user_menu() {
    echo ""
    echo -e "${RED}$(L which_user_delete)${NC}"
    echo ""

    i=1
    for user in "${USERS[@]}"; do
        echo -e "  ${RED}$i)${NC} $user"
        ((i++))
    done
    echo ""
    echo -e "  ${GRAY}0)${NC} $(L cancel)"
    echo ""

    echo -ne "${RED}$(L number) : ${NC}"
    read -r del_choice

    if [[ "$del_choice" =~ ^[0-9]+$ ]] && [ "$del_choice" -ge 1 ] && [ "$del_choice" -le ${#USERS[@]} ]; then
        local user_to_delete="${USERS[$((del_choice-1))]}"
        echo -ne "${RED}$(L really_delete) '$user_to_delete' ? (o/N) ${NC}"
        read -r confirm

        if [[ "$confirm" =~ ^[OoYy]$ ]]; then
            # URL encode the userId for the DELETE request
            local encoded_user=$(echo "$user_to_delete" | jq -sRr @uri)
            local result=$(curl -s -X DELETE "$SERVER_URL/api/v1/users/$encoded_user" 2>/dev/null)
            echo -e "${GREEN}✓ $(L user_deleted)${NC}"
            sleep 1
        fi
    fi

    # Retour au menu de sélection
    select_user
}

# Onboarding pour nouveaux utilisateurs (conversationnel)
run_onboarding() {
    # Check if onboarding is needed
    local check=$(curl -s "$SERVER_URL/api/v1/onboarding/check?userId=$(echo "$USER_ID" | jq -sRr @uri)" 2>/dev/null)
    local needs=$(echo "$check" | jq -r '.needsOnboarding // false' 2>/dev/null)

    if [ "$needs" != "true" ]; then
        return
    fi

    # Mark onboarding as complete
    curl -s -X POST "$SERVER_URL/api/v1/onboarding/skip" \
        -H "Content-Type: application/json" \
        -d "{\"userId\":\"$USER_ID\"}" > /dev/null 2>&1

    # Mira génère son propre message de bienvenue via l'API
    echo ""
    echo -ne "${PURPLE}Mira: ${NC}"

    local welcome_response=$(curl -s -X POST "$SERVER_URL/api/v1/messages/welcome" \
        -H "Content-Type: application/json" \
        -d "{\"userId\":\"$USER_ID\"}" 2>/dev/null)

    local welcome_text=$(echo "$welcome_response" | jq -r '.message // "Salut ! Je suis Mira. Comment tu vas ?"')
    echo -e "$welcome_text"
    echo ""
}

# Animated loading spinner
show_loading() {
    local pid=$1
    local msg="${2:-$(L mira_writes)}"
    local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    while kill -0 $pid 2>/dev/null; do
        local temp=${spinstr#?}
        printf "\r${GRAY}%s %s...${NC}" "${spinstr:0:1}" "$msg"
        spinstr=$temp${spinstr%"$temp"}
        sleep 0.1
    done
    printf "\r\033[K"  # Clear the line
}

# Generate Mira's greeting (welcome for new users, resume for recent conversations, re-engagement for returning)
generate_mira_greeting() {
    local encoded_user=$(echo "$USER_ID" | jq -sRr @uri)

    # CHECK FOR RECENT CONVERSATION FIRST (within last 2 hours)
    # If user was talking recently, resume conversation instead of greeting
    # Use tr to clean control characters that can break jq
    local history=$(curl -s "$SERVER_URL/api/v1/messages/history?userId=$encoded_user&limit=20" 2>/dev/null | tr -d '\000-\011\013\014\016-\037')

    # Filter out greeting messages (intro patterns with "Mira" or "comment tu vas/ça va")
    local real_messages=$(echo "$history" | jq '[.messages[] | select(
        ((.content | test("^(Salut|Hey|Coucou)"; "i")) and ((.content | contains("Mira")) or (.content | test("comment (tu vas|ça va)"; "i"))))
        | not
    )]' 2>/dev/null)
    local real_count=$(echo "$real_messages" | jq 'length' 2>/dev/null)
    local last_timestamp=$(echo "$real_messages" | jq -r '.[0].timestamp // ""' 2>/dev/null)

    # Only resume if there's a real conversation (at least 2 non-greeting messages)
    if [ "$real_count" -ge 2 ] && [ -n "$last_timestamp" ] && [ "$last_timestamp" != "null" ]; then
        # Calculate time since last message (in seconds)
        local now=$(date +%s)
        local last_time=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${last_timestamp%%.*}" +%s 2>/dev/null || echo "0")

        # If last_time parsing failed (Linux), try alternative
        if [ "$last_time" = "0" ]; then
            last_time=$(date -d "${last_timestamp%%.*}" +%s 2>/dev/null || echo "0")
        fi

        local diff=$((now - last_time))
        local two_hours=$((2 * 60 * 60))

        if [ "$diff" -lt "$two_hours" ] && [ "$diff" -gt 0 ]; then
            # Recent conversation - show last messages and resume
            echo ""
            echo -e "${GRAY}━━━ $(L ongoing_convo) ━━━${NC}"

            # Display last 4 real messages (reversed to show oldest first)
            echo "$real_messages" | jq -r '
                reverse |
                .[-4:] |
                .[] |
                if .role == "user" then
                    "\u001b[36m" + .username + ": \u001b[0m" + .content
                else
                    "\u001b[35mMira: \u001b[0m" + .content
                end
            ' 2>/dev/null

            echo -e "${GRAY}━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo ""

            # No greeting needed - conversation continues
            return
        fi
    fi

    # Check for re-engagement message (returning user after a while)
    local reengagement=$(curl -s "$SERVER_URL/api/v1/messages/reengagement?userId=$encoded_user" 2>/dev/null)
    local has_message=$(echo "$reengagement" | jq -r '.hasMessage // false' 2>/dev/null)

    if [ "$has_message" = "true" ]; then
        local message=$(echo "$reengagement" | jq -r '.message // ""' 2>/dev/null)
        if [ -n "$message" ]; then
            echo -e "${PURPLE}Mira: ${NC}$message"
            echo ""
            return
        fi
    fi

    # Regular returning user - simple greeting (with loading animation)
    {
        curl -s -X POST "$SERVER_URL/api/v1/messages/greeting" \
            -H "Content-Type: application/json" \
            -d "{\"userId\":\"$USER_ID\",\"lang\":\"$LANG_MODE\"}" > /tmp/mira_greeting.json 2>/dev/null
    } &
    local curl_pid=$!
    show_loading $curl_pid "$(L mira_writes)"
    wait $curl_pid

    local greeting_text=$(cat /tmp/mira_greeting.json 2>/dev/null | jq -r '.message // ""')
    rm -f /tmp/mira_greeting.json

    if [ -n "$greeting_text" ] && [ "$greeting_text" != "null" ]; then
        echo -e "${PURPLE}Mira: ${NC}$greeting_text"
        echo ""
    fi
}

# Record audio message
# Returns the audio file path in AUDIO_RESULT global variable
AUDIO_RESULT=""

record_audio() {
    AUDIO_RESULT=""

    if [ "$HAS_SOX" != "true" ]; then
        echo -e "${RED}SoX non installé. Installe-le avec: brew install sox${NC}"
        return 1
    fi

    local audio_file="$AUDIO_DIR/recording_$(date +%s).wav"

    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}🎤 $(L recording)${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${YELLOW}   $(L press_enter_stop)${NC}"
    echo ""

    # Start recording in background
    rec -q "$audio_file" rate 16k channels 1 2>/dev/null &
    local rec_pid=$!

    # Show recording indicator - wait for Enter key to stop
    local start_time=$(date +%s)
    {
        # Background timer display
        while kill -0 $rec_pid 2>/dev/null; do
            local now=$(date +%s)
            local elapsed=$((now - start_time))
            local mins=$((elapsed / 60))
            local secs=$((elapsed % 60))
            printf "\r   ${RED}● REC${NC} %02d:%02d " $mins $secs
            sleep 1
        done
    } &
    local timer_pid=$!

    # Wait for Enter key (blocking)
    read -r _

    # Stop timer display
    kill $timer_pid 2>/dev/null
    wait $timer_pid 2>/dev/null

    # Stop recording
    kill $rec_pid 2>/dev/null
    wait $rec_pid 2>/dev/null

    # Small delay to ensure file is written
    sleep 0.3

    echo ""

    if [ -f "$audio_file" ] && [ -s "$audio_file" ]; then
        local file_size=$(stat -f%z "$audio_file" 2>/dev/null || stat -c%s "$audio_file" 2>/dev/null)
        if [ "$file_size" -gt 1000 ]; then
            echo -e "${GREEN}✓ $(L audio_recorded)${NC}"
            echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo ""
            AUDIO_RESULT="$audio_file"
            return 0
        else
            echo -e "${RED}✗ $(L recording_too_short)${NC}"
            echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo ""
            rm -f "$audio_file" 2>/dev/null
            return 1
        fi
    else
        echo -e "${RED}✗ Recording error${NC}"
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        return 1
    fi
}

# Send audio to server
send_audio() {
    local audio_file="$1"

    if [ ! -f "$audio_file" ]; then
        echo -e "${RED}Fichier audio non trouvé${NC}"
        return 1
    fi

    echo -e "${GRAY}$(L sending_audio)${NC}"

    local response=$(curl -s -X POST "$SERVER_URL/chat" \
        -F "audio=@$audio_file;type=audio/wav" \
        -F "userId=$USER_ID" \
        -F "lang=$LANG_MODE" \
        2>&1)

    # Debug: show raw response if it looks like an error
    if [ -z "$response" ] || echo "$response" | grep -q '"error"'; then
        echo -e "${RED}Erreur serveur:${NC} $response"
        rm -f "$audio_file" 2>/dev/null
        return 1
    fi

    local text_response=$(echo "$response" | jq -r '.response // "..."')
    local input_type=$(echo "$response" | jq -r '.inputType // "text"')
    local has_audio=$(echo "$response" | jq -r '.audioResponse // null')

    # Show transcribed input if available
    if [ "$input_type" = "audio" ]; then
        echo -e "${GRAY}(Transcrit: voir ci-dessous)${NC}"
    fi

    echo -e "${PURPLE}Mira: ${NC}$text_response"

    # Play audio response if available
    if [ "$has_audio" != "null" ] && [ -n "$has_audio" ]; then
        play_audio_response "$has_audio"
    fi

    echo ""

    # Cleanup
    rm -f "$audio_file" 2>/dev/null

    return 0
}

# Play audio response from base64
play_audio_response() {
    local audio_base64="$1"
    local audio_file="$AUDIO_DIR/response_$(date +%s).wav"

    echo -e "${CYAN}🔊 Lecture de la réponse audio...${NC}"

    # Decode base64 and save
    echo "$audio_base64" | base64 -d > "$audio_file" 2>/dev/null

    if [ -f "$audio_file" ] && [ -s "$audio_file" ]; then
        # Play with afplay (macOS) or aplay (Linux)
        if command -v afplay &> /dev/null; then
            afplay "$audio_file" 2>/dev/null
        elif command -v aplay &> /dev/null; then
            aplay -q "$audio_file" 2>/dev/null
        elif command -v play &> /dev/null; then
            play -q "$audio_file" 2>/dev/null
        else
            echo -e "${GRAY}(Lecture audio non disponible sur ce système)${NC}"
        fi
        rm -f "$audio_file" 2>/dev/null
    fi
}

# Visualize audio levels (simple terminal visualization)
visualize_audio() {
    if [ "$HAS_SOX" != "true" ]; then
        echo -e "${RED}SoX non installé. Installe-le avec: brew install sox${NC}"
        return 1
    fi

    echo -e "${CYAN}🎵 Visualisation audio en temps réel${NC}"
    echo -e "${GRAY}(Ctrl+C pour arrêter)${NC}"
    echo ""

    # Simple visualization using sox stat
    rec -q -n stats 2>&1 | while read line; do
        if [[ "$line" == *"RMS"* ]]; then
            local level=$(echo "$line" | grep -oE '[0-9]+\.[0-9]+' | head -1)
            if [ -n "$level" ]; then
                local bars=$(echo "$level * 50" | bc 2>/dev/null | cut -d. -f1)
                [ -z "$bars" ] && bars=0
                local bar=""
                for ((i=0; i<bars && i<50; i++)); do
                    bar="${bar}█"
                done
                printf "\r${CYAN}%-50s${NC}" "$bar"
            fi
        fi
    done
}

# Show chat help
show_chat_help() {
    echo ""
    echo -e "${CYAN}$(L commands_help):${NC}"
    echo -e "  ${GREEN}/audio${NC} ou ${GREEN}/a${NC}   - $(L record_audio)"
    echo -e "  ${GREEN}/viz${NC}          - $(L visualize_mic)"
    echo -e "  ${GREEN}/history${NC}      - $(L view_history)"
    echo -e "  ${GREEN}/clear${NC}        - $(L clear_data)"
    echo -e "  ${GREEN}/setup${NC}        - $(L reconfigure)"
    echo -e "  ${GREEN}/help${NC}         - $(L show_help)"
    echo -e "  ${GREEN}quit${NC}          - $(L quit)"
    echo ""
    if [ "$HAS_AUDIO" != "true" ]; then
        echo -e "${GRAY}Note: Audio mode disabled. To enable:${NC}"
        echo -e "${GRAY}  brew install sox${NC}"
        echo ""
    fi
}

# Clear all user data
clear_user_data() {
    echo ""
    echo -e "${RED}⚠️  ATTENTION: $(L warning_delete_all)${NC}"
    echo -e "${GRAY}   - $(L messages)${NC}"
    echo -e "${GRAY}   - $(L memories)${NC}"
    echo -e "${GRAY}   - $(L goals)${NC}"
    echo -e "${GRAY}   - $(L events)${NC}"
    echo -e "${GRAY}   - $(L profile)${NC}"
    echo ""
    echo -ne "${RED}$(L confirm_delete): ${NC}"
    read -r confirm

    if [ "$confirm" = "$(L confirm_word)" ]; then
        echo -e "${YELLOW}$(L deleting)${NC}"
        local encoded_user=$(echo "$USER_ID" | jq -sRr @uri)
        curl -s -X DELETE "$SERVER_URL/api/v1/users/$encoded_user" > /dev/null 2>&1
        echo -e "${GREEN}✓ $(L deleted)${NC}"
        echo ""
        echo -e "${CYAN}$(L restart_fresh)${NC}"
        echo ""

        # Re-generate greeting as new user
        generate_mira_greeting
    else
        echo -e "${GRAY}$(L cancelled)${NC}"
    fi
    echo ""
}

# Show conversation history
show_history() {
    local encoded_user=$(echo "$USER_ID" | jq -sRr @uri)
    local history=$(curl -s "$SERVER_URL/api/v1/messages/history?userId=$encoded_user&limit=20" 2>/dev/null)

    local count=$(echo "$history" | jq -r '.count // 0' 2>/dev/null)

    if [ "$count" = "0" ] || [ -z "$count" ]; then
        echo ""
        echo -e "${GRAY}$(L no_history)${NC}"
        echo ""
        return
    fi

    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}📜 $(L recent_history)${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Parse and display messages
    echo "$history" | jq -r '.messages[] | "\(.role)|\(.content)|\(.timestamp)"' 2>/dev/null | while IFS='|' read -r role content timestamp; do
        # Format timestamp (extract just the date/time part)
        local formatted_time=$(echo "$timestamp" | cut -d'T' -f1,2 | tr 'T' ' ' | cut -d':' -f1,2)

        if [ "$role" = "user" ]; then
            echo -e "${GRAY}[$formatted_time]${NC} ${GREEN}$USER_ID:${NC} $content"
        else
            echo -e "${GRAY}[$formatted_time]${NC} ${PURPLE}Mira:${NC} $content"
        fi
    done

    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Display recent conversation when starting chat (for returning users)
display_recent_conversation() {
    local encoded_user=$(echo "$USER_ID" | jq -sRr @uri)
    local history=$(curl -s "$SERVER_URL/api/v1/messages/history?userId=$encoded_user&limit=6" 2>/dev/null)

    local count=$(echo "$history" | jq -r '.count // 0' 2>/dev/null)

    if [ "$count" = "0" ] || [ -z "$count" ] || [ "$count" = "null" ]; then
        return
    fi

    echo -e "${GRAY}━━ $(L last_convo) ━━${NC}"
    echo ""

    # Parse and display messages (in reverse order for chronological display)
    echo "$history" | jq -r '.messages | reverse | .[] | "\(.role)|\(.content)"' 2>/dev/null | while IFS='|' read -r role content; do
        # Truncate long messages
        if [ ${#content} -gt 100 ]; then
            content="${content:0:100}..."
        fi

        if [ "$role" = "user" ]; then
            echo -e "  ${GREEN}$USER_ID:${NC} ${GRAY}$content${NC}"
        else
            echo -e "  ${PURPLE}Mira:${NC} ${GRAY}$content${NC}"
        fi
    done

    echo ""
    echo -e "${GRAY}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Interface de chat
chat() {
    clear
    echo -e "${PURPLE}"
    echo "  __  __ _           "
    echo " |  \/  (_)_ __ __ _ "
    echo " | |\/| | | '__/ _\` |"
    echo " | |  | | | | | (_| |"
    echo " |_|  |_|_|_|  \__,_|"
    echo -e "${NC}"
    echo ""
    echo -e "${GRAY}$(L type_help)${NC}"

    if [ "$HAS_AUDIO" = "true" ]; then
        echo -e "${GRAY}$(L audio_enabled)${NC}"
    fi
    echo ""

    # Show recent conversation for returning users
    display_recent_conversation

    # Mira génère son message d'accueil OU de re-engagement
    generate_mira_greeting

    while true; do
        echo -ne "${GREEN}$USER_ID: ${NC}"
        read -r message

        # Handle quit commands
        if [ "$message" = "quit" ] || [ "$message" = "exit" ] || [ "$message" = "q" ]; then
            echo -e "\n${PURPLE}$(L quit_msg) $USER_ID !${NC}\n"
            cleanup
        fi

        # Handle special commands
        if [ "$message" = "/help" ] || [ "$message" = "/h" ]; then
            show_chat_help
            continue
        fi

        if [ "$message" = "/audio" ] || [ "$message" = "/a" ]; then
            record_audio
            if [ $? -eq 0 ] && [ -n "$AUDIO_RESULT" ]; then
                send_audio "$AUDIO_RESULT"
            fi
            continue
        fi

        if [ "$message" = "/viz" ]; then
            visualize_audio
            continue
        fi

        if [ "$message" = "/install-audio" ]; then
            install_audio_deps
            continue
        fi

        if [ "$message" = "/clear" ]; then
            clear_user_data
            continue
        fi

        if [ "$message" = "/history" ]; then
            show_history
            continue
        fi

        if [ "$message" = "/setup" ]; then
            echo ""
            echo -e "${YELLOW}Reconfiguration des clés API...${NC}"
            echo -e "${GRAY}Le serveur va redémarrer après la configuration.${NC}"
            echo ""
            setup_env
            # Restart server with new config
            start_server
            continue
        fi

        if [ -z "$message" ]; then
            continue
        fi

        # Send text message to Mira (silent - no loading indicator for suspense)
        curl -s -X POST "$SERVER_URL/chat" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg u "$USER_ID" --arg m "$message" --arg l "$LANG_MODE" '{userId:$u,message:$m,lang:$l}')" > /tmp/mira_response.json 2>/dev/null

        response=$(cat /tmp/mira_response.json 2>/dev/null)
        rm -f /tmp/mira_response.json

        text_response=$(echo "$response" | jq -r '.response // "..."')
        audio_response=$(echo "$response" | jq -r '.audioResponse // null')
        typing_delay=$(echo "$response" | jq -r '.typingDelay // 0')

        # Simulate WhatsApp-like "seen" then "typing..." behavior
        echo -ne "${GRAY}$(L seen) ✓✓${NC}"
        sleep 0.5

        # Show "typing..." with delay (capped at 8 seconds for UX)
        if [ "$typing_delay" != "null" ] && [ "$typing_delay" != "0" ]; then
            # Convert ms to seconds, cap at 8 seconds
            local delay_sec=$(echo "scale=1; $typing_delay / 1000" | bc 2>/dev/null || echo "2")
            if (( $(echo "$delay_sec > 8" | bc -l 2>/dev/null || echo 0) )); then
                delay_sec=8
            fi

            # Show typing animation for delay duration
            printf "\r${GRAY}$(L mira_writes)...${NC}    "

            # Animate dots while waiting
            local elapsed=0
            while (( $(echo "$elapsed < $delay_sec" | bc -l 2>/dev/null || echo 0) )); do
                for dots in "." ".." "..."; do
                    printf "\r${GRAY}$(L mira_writes)${dots}${NC}    "
                    sleep 0.3
                    elapsed=$(echo "$elapsed + 0.3" | bc 2>/dev/null || echo "$delay_sec")
                    if (( $(echo "$elapsed >= $delay_sec" | bc -l 2>/dev/null || echo 1) )); then
                        break 2
                    fi
                done
            done
        else
            # Default short delay if no typing delay from backend
            printf "\r${GRAY}$(L mira_writes)...${NC}    "
            sleep 1
        fi

        # Clear the line and show response
        printf "\r\033[K"
        echo -e "${PURPLE}Mira: ${NC}$text_response"

        # Play audio response if available (random ~25% of the time from server)
        if [ "$audio_response" != "null" ] && [ -n "$audio_response" ]; then
            play_audio_response "$audio_response"
        fi

        echo ""
    done
}

# Main
select_language  # Choose language first
check_env        # Setup wizard if .env missing
check_deps
start_server
select_user
chat
