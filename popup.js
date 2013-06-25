var bgpage = chrome.extension.getBackgroundPage();
var chrome_bookmarks = bgpage.chrome_bookmarks;

function adaptMenu() {
    switch (chrome.extension.getBackgroundPage().currentAction) {
        case "add":
            document.getElementById("add").style.display = "block";
            document.getElementById("remove").style.display = "none";
            break;
        case "remove":
            document.getElementById("add").style.display = "none";
            document.getElementById("remove").style.display = "block";
            break;
        default: console.log("shouldn't be here");
    }
}

function addBookmarkToFolder(bookmark, parent) {
    var content;
    if (bookmark.url) {
        content = document.createElement("a");
        content.href = bookmark.url;
        content.setAttribute("data-bookmark-id", bookmark.id);
        content.appendChild(document.createTextNode(bookmark.title || "Untitled bookmark"));
        content.title = bookmark.title;
        content.onclick = function(e) {
            chrome.tabs.update({url: content.href});
        };
    } else {
        content = document.createElement("details");
        var summary = document.createElement("summary");
        var ul = document.createElement("ul");
        summary.appendChild(document.createTextNode(bookmark.title || "Untitled folder"));
        content.appendChild(summary);
        content.appendChild(ul);
        summary.onclick = function() {
            if (!content.open) {
                // lazily load content
                ul.innerHTML = "";
                chrome_bookmarks.getChildren(bookmark.id, function(children) {
                    children.forEach(function(child) {
                        addBookmarkToFolder(child, ul);
                    });
                });
            }
        };
    }
    var li = document.createElement("li");
    li.appendChild(content);
    parent.appendChild(li);
}

function initiallyPopulateBookmarks() {
    chrome_bookmarks.getChildren("0", function(bookmarks) {
        var toplevel = document.getElementById("toplevel");
        bookmarks.forEach(function(bookmark) {
            addBookmarkToFolder(bookmark, toplevel);
        });
    });
}

document.querySelector("#add button").onclick = function() { bgpage.bookmarkCurrentTab(adaptMenu); };
document.querySelector("#remove button").onclick = function() { bgpage.unbookmarkCurrentTab(adaptMenu); };
document.querySelector("#manage button").onclick = function() { chrome.tabs.create({url: "options.html"}); };

document.addEventListener('DOMContentLoaded', function () {
    adaptMenu();
});

chrome_bookmarks.onCreated.addListener(function(id, bookmark) {
    var parentFolder = document.querySelector("[data-bookmark-id='" + bookmark.parentId + "']");
    if (parentFolder) {
        addBookmarkToFolder(bookmark, parentFolder);
    }
});
chrome_bookmarks.onRemoved.addListener(function(id, removeInfo) {
    var bookmarkItem = document.querySelector("[data-bookmark-id='" + id + "']");
    if (bookmarkItem) {
        bookmarkItem.parentNode.parentNode.removeChild(bookmarkItem.parentNode);
    }
});

initiallyPopulateBookmarks();
