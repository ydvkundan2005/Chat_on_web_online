function showLanding(){
      try {
        document.getElementById("landing").style.display = "block";
        document.getElementById("nicknamePage").style.display = "none";
        document.getElementById("successPage").style.display = "none";
        document.getElementById("loginPage").style.display = "none";
        document.getElementById("chatPage").style.display = "none";
      } catch(e){}
    }
    function showNicknamePage(){
      try {
        document.getElementById("landing").style.display = "none";
        document.getElementById("nicknamePage").style.display = "block";
        document.getElementById("nicknameInput").value = "";
        document.getElementById("loading").style.display = "none";
        document.getElementById("generatedDetails").style.display = "none";
        document.getElementById("generatedId").value = "";
        document.getElementById("createPassword").value = "";
      } catch(e){}
    }
    function showLoginPage(){
      try {
        document.getElementById("landing").style.display = "none";
        document.getElementById("loginPage").style.display = "block";
        document.getElementById("loginId").value = "";
        document.getElementById("loginPassword").value = "";
      } catch(e){}
    }
