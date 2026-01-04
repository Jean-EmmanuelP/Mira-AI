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

SERVER_URL="http://localhost:3000"
USER_ID=""
AUDIO_DIR="/tmp/mira-audio"
HAS_SOX=false
HAS_AUDIO=false

# Fonction cleanup
cleanup() {
    echo -e "\n${BLUE}Arrêt de Mira...${NC}"
    pkill -f "tsx watch src/main.ts" 2>/dev/null
    lsof -ti:3000 | xargs kill -9 2>/dev/null
    rm -rf "$AUDIO_DIR" 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

# Vérifier les dépendances
check_deps() {
    echo -e "${BLUE}Vérification des dépendances...${NC}"

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
        echo -e "${GREEN}✓ SoX disponible (enregistrement audio activé)${NC}"
    else
        echo -e "${YELLOW}SoX non installé - Mode audio désactivé${NC}"
        if command -v brew &> /dev/null; then
            echo -ne "${CYAN}Veux-tu installer SoX pour l'audio ? (o/N) ${NC}"
            read -r install_sox
            if [[ "$install_sox" =~ ^[OoYy]$ ]]; then
                echo -e "${BLUE}Installation de SoX...${NC}"
                brew install sox 2>/dev/null
                if command -v sox &> /dev/null; then
                    HAS_SOX=true
                    HAS_AUDIO=true
                    echo -e "${GREEN}✓ SoX installé avec succès!${NC}"
                else
                    echo -e "${RED}Échec de l'installation${NC}"
                fi
            fi
        else
            echo -e "${GRAY}  Pour activer: brew install sox${NC}"
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
    echo -e "${BLUE}Démarrage du serveur Mira...${NC}"

    # Kill ancien serveur si existe
    pkill -f "tsx watch src/main.ts" 2>/dev/null
    lsof -ti:3000 | xargs kill -9 2>/dev/null
    sleep 1

    # Lancer en background
    npm run dev > /tmp/mira-server.log 2>&1 &
    SERVER_PID=$!

    # Attendre que le serveur soit prêt
    echo -ne "${BLUE}Connexion"
    for i in {1..20}; do
        if curl -s $SERVER_URL/health > /dev/null 2>&1; then
            echo -e "${NC}"
            echo -e "${GREEN}✓ Serveur prêt!${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
    done

    echo -e "${NC}"
    echo -e "${RED}✗ Erreur: Le serveur n'a pas démarré${NC}"
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
    echo -e "${BLUE}Ton amie qui te connaît vraiment${NC}"
    echo ""

    # Récupérer les utilisateurs existants
    echo -e "${GRAY}Chargement...${NC}"

    USERS_JSON=$(curl -s "$SERVER_URL/api/v1/users" 2>/dev/null)

    if [ -z "$USERS_JSON" ] || [ "$USERS_JSON" = "null" ]; then
        echo ""
        echo -e "${PURPLE}Comment tu t'appelles ?${NC}"
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
        echo -e "${CYAN}Première connexion !${NC}"
        echo ""
        echo -e "${PURPLE}Comment tu t'appelles ?${NC}"
        read -r USER_ID
        if [ -z "$USER_ID" ]; then
            USER_ID="ami"
        fi
        return
    fi

    echo ""
    echo -e "${CYAN}Qui es-tu ?${NC}"
    echo ""

    i=1
    for user in "${USERS[@]}"; do
        echo -e "  ${GREEN}$i)${NC} $user"
        ((i++))
    done
    echo ""
    echo -e "  ${GREEN}N)${NC} Nouveau"
    echo -e "  ${RED}D)${NC} Supprimer un utilisateur"
    echo ""

    echo -ne "${PURPLE}Ton choix : ${NC}"
    read -r choice

    if [[ "$choice" =~ ^[Nn]$ ]]; then
        echo -ne "${PURPLE}Comment tu t'appelles ? ${NC}"
        read -r USER_ID
        if [ -z "$USER_ID" ]; then
            USER_ID="ami"
        fi
    elif [[ "$choice" =~ ^[Dd]$ ]]; then
        delete_user_menu
    elif [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le ${#USERS[@]} ]; then
        USER_ID="${USERS[$((choice-1))]}"
        echo -e "${GREEN}Content de te revoir, $USER_ID !${NC}"
        sleep 1
    else
        echo -e "${YELLOW}Choix invalide...${NC}"
        echo -ne "${PURPLE}Comment tu t'appelles ? ${NC}"
        read -r USER_ID
        if [ -z "$USER_ID" ]; then
            USER_ID="ami"
        fi
    fi
}

# Menu de suppression d'utilisateur
delete_user_menu() {
    echo ""
    echo -e "${RED}Quel utilisateur supprimer ?${NC}"
    echo ""

    i=1
    for user in "${USERS[@]}"; do
        echo -e "  ${RED}$i)${NC} $user"
        ((i++))
    done
    echo ""
    echo -e "  ${GRAY}0)${NC} Annuler"
    echo ""

    echo -ne "${RED}Numéro : ${NC}"
    read -r del_choice

    if [[ "$del_choice" =~ ^[0-9]+$ ]] && [ "$del_choice" -ge 1 ] && [ "$del_choice" -le ${#USERS[@]} ]; then
        local user_to_delete="${USERS[$((del_choice-1))]}"
        echo -ne "${RED}Vraiment supprimer '$user_to_delete' ? (o/N) ${NC}"
        read -r confirm

        if [[ "$confirm" =~ ^[OoYy]$ ]]; then
            # URL encode the userId for the DELETE request
            local encoded_user=$(echo "$user_to_delete" | jq -sRr @uri)
            local result=$(curl -s -X DELETE "$SERVER_URL/api/v1/users/$encoded_user" 2>/dev/null)
            echo -e "${GREEN}✓ Utilisateur supprimé${NC}"
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
    local msg="${2:-Mira réfléchit}"
    local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    while kill -0 $pid 2>/dev/null; do
        local temp=${spinstr#?}
        printf "\r${GRAY}%s %s...${NC}" "${spinstr:0:1}" "$msg"
        spinstr=$temp${spinstr%"$temp"}
        sleep 0.1
    done
    printf "\r\033[K"  # Clear the line
}

# Generate Mira's greeting (welcome for new users, re-engagement for returning, or simple greeting)
generate_mira_greeting() {
    local encoded_user=$(echo "$USER_ID" | jq -sRr @uri)

    # First check if this is a NEW user (needs onboarding)
    local check=$(curl -s "$SERVER_URL/api/v1/onboarding/check?userId=$encoded_user" 2>/dev/null)
    local needs_onboarding=$(echo "$check" | jq -r '.needsOnboarding // false' 2>/dev/null)

    if [ "$needs_onboarding" = "true" ]; then
        # Mark onboarding as complete
        curl -s -X POST "$SERVER_URL/api/v1/onboarding/skip" \
            -H "Content-Type: application/json" \
            -d "{\"userId\":\"$USER_ID\"}" > /dev/null 2>&1

        # New user - generate welcome message (with loading animation)
        {
            curl -s -X POST "$SERVER_URL/api/v1/messages/welcome" \
                -H "Content-Type: application/json" \
                -d "{\"userId\":\"$USER_ID\"}" > /tmp/mira_greeting.json 2>/dev/null
        } &
        local curl_pid=$!
        show_loading $curl_pid "Mira arrive"
        wait $curl_pid

        local welcome_text=$(cat /tmp/mira_greeting.json 2>/dev/null | jq -r '.message // "Salut ! Je suis Mira. Comment tu vas ?"')
        rm -f /tmp/mira_greeting.json

        echo -e "${PURPLE}Mira: ${NC}$welcome_text"
        echo ""
        return
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
            -d "{\"userId\":\"$USER_ID\"}" > /tmp/mira_greeting.json 2>/dev/null
    } &
    local curl_pid=$!
    show_loading $curl_pid "Mira arrive"
    wait $curl_pid

    local greeting_text=$(cat /tmp/mira_greeting.json 2>/dev/null | jq -r '.message // ""')
    rm -f /tmp/mira_greeting.json

    if [ -n "$greeting_text" ] && [ "$greeting_text" != "null" ]; then
        echo -e "${PURPLE}Mira: ${NC}$greeting_text"
        echo ""
    fi
}

# Record audio message
record_audio() {
    if [ "$HAS_SOX" != "true" ]; then
        echo -e "${RED}SoX non installé. Installe-le avec: brew install sox${NC}"
        return 1
    fi

    local audio_file="$AUDIO_DIR/recording_$(date +%s).wav"

    echo -e "${CYAN}🎤 Enregistrement en cours...${NC}"
    echo -e "${YELLOW}>>> Appuie sur ENTRÉE pour arrêter <<<${NC}"
    echo ""

    # Start recording in background
    rec -q "$audio_file" rate 16k channels 1 2>/dev/null &
    local rec_pid=$!

    # Wait for Enter key
    read -r _

    # Stop recording
    kill $rec_pid 2>/dev/null
    wait $rec_pid 2>/dev/null

    # Small delay to ensure file is written
    sleep 0.3

    if [ -f "$audio_file" ] && [ -s "$audio_file" ]; then
        local file_size=$(stat -f%z "$audio_file" 2>/dev/null || stat -c%s "$audio_file" 2>/dev/null)
        if [ "$file_size" -gt 1000 ]; then
            echo -e "${GREEN}✓ Audio enregistré (${file_size} bytes)${NC}"
            echo "$audio_file"
            return 0
        else
            echo -e "${RED}✗ Enregistrement trop court${NC}"
            rm -f "$audio_file" 2>/dev/null
            return 1
        fi
    else
        echo -e "${RED}✗ Erreur d'enregistrement${NC}"
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

    echo -e "${GRAY}Envoi de l'audio...${NC}"

    local response=$(curl -s -X POST "$SERVER_URL/chat" \
        -F "audio=@$audio_file;type=audio/wav" \
        -F "userId=$USER_ID" \
        2>/dev/null)

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
    echo -e "${CYAN}Commandes disponibles:${NC}"
    echo -e "  ${GREEN}/audio${NC} ou ${GREEN}/a${NC}   - Enregistrer un message audio"
    echo -e "  ${GREEN}/viz${NC}          - Visualiser l'audio du micro en temps réel"
    echo -e "  ${GREEN}/help${NC}         - Afficher cette aide"
    echo -e "  ${GREEN}quit${NC}          - Quitter"
    echo ""
    if [ "$HAS_AUDIO" != "true" ]; then
        echo -e "${GRAY}Note: Mode audio désactivé. Pour activer:${NC}"
        echo -e "${GRAY}  brew install sox${NC}"
        echo ""
    fi
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
    echo -e "${GRAY}Tape '/help' pour les commandes.${NC}"

    if [ "$HAS_AUDIO" = "true" ]; then
        echo -e "${GRAY}Mode audio activé: /audio pour enregistrer${NC}"
    fi
    echo ""

    # Mira génère son message d'accueil OU de re-engagement
    generate_mira_greeting

    while true; do
        echo -ne "${GREEN}$USER_ID: ${NC}"
        read -r message

        # Handle quit commands
        if [ "$message" = "quit" ] || [ "$message" = "exit" ] || [ "$message" = "q" ]; then
            echo -e "\n${PURPLE}À bientôt $USER_ID !${NC}\n"
            cleanup
        fi

        # Handle special commands
        if [ "$message" = "/help" ] || [ "$message" = "/h" ]; then
            show_chat_help
            continue
        fi

        if [ "$message" = "/audio" ] || [ "$message" = "/a" ]; then
            local audio_file=$(record_audio)
            if [ $? -eq 0 ] && [ -n "$audio_file" ]; then
                send_audio "$audio_file"
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

        if [ -z "$message" ]; then
            continue
        fi

        # Send text message to Mira (with loading animation)
        {
            curl -s -X POST "$SERVER_URL/chat" \
                -H "Content-Type: application/json" \
                -d "$(jq -n --arg u "$USER_ID" --arg m "$message" '{userId:$u,message:$m}')" > /tmp/mira_response.json 2>/dev/null
        } &
        local curl_pid=$!
        show_loading $curl_pid "Mira réfléchit"
        wait $curl_pid

        response=$(cat /tmp/mira_response.json 2>/dev/null)
        rm -f /tmp/mira_response.json

        text_response=$(echo "$response" | jq -r '.response // "..."')
        audio_response=$(echo "$response" | jq -r '.audioResponse // null')

        echo -e "${PURPLE}Mira: ${NC}$text_response"

        # Play audio response if available (random ~25% of the time from server)
        if [ "$audio_response" != "null" ] && [ -n "$audio_response" ]; then
            play_audio_response "$audio_response"
        fi

        echo ""
    done
}

# Main
check_deps
start_server
select_user
chat
